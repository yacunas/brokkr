import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  ClassScalarCodec,
  CircularReferenceError,
  defineCodec,
  MaxDepthError,
  Serde,
  UnknownTagError,
  UnknownTypeError,
  UnsupportedTypeError,
  VersionedCodec,
  clone,
  deserialize,
  serialize,
} from "./index";
import type { DecodeContext, EncodeContext, JsonValue } from "./index";

/** Round-trip helper for the shared default instance. */
function roundTrip<T>(value: T): T {
  return deserialize<T>(serialize(value));
}

describe("primitives and built-ins", () => {
  it("round-trips JSON-native primitives", () => {
    expect(roundTrip("hi")).toBe("hi");
    expect(roundTrip(42)).toBe(42);
    expect(roundTrip(true)).toBe(true);
    expect(roundTrip(null)).toBe(null);
  });

  it("round-trips values JSON.stringify loses", () => {
    expect(roundTrip(undefined)).toBe(undefined);
    expect(roundTrip(123n)).toBe(123n);
    expect(roundTrip(Number.NaN)).toBeNaN();
    expect(roundTrip(Infinity)).toBe(Infinity);
    expect(roundTrip(-Infinity)).toBe(-Infinity);
  });

  it("round-trips Date, Map, Set, RegExp and URL", () => {
    const date = new Date("2026-01-02T03:04:05.678Z");
    expect(roundTrip(date)).toEqual(date);

    const map = new Map<string, number>([["a", 1], ["b", 2]]);
    expect(roundTrip(map)).toEqual(map);

    const set = new Set([1, 2, 3]);
    expect(roundTrip(set)).toEqual(set);

    const re = /ab+c/gi;
    const back = roundTrip(re);
    expect(back.source).toBe(re.source);
    expect(back.flags).toBe(re.flags);

    const url = new URL("https://example.com/path?q=1");
    expect(roundTrip(url).href).toBe(url.href);
  });

  it("produces valid JSON on the wire", () => {
    expect(() => JSON.parse(serialize({ a: new Date(), b: 1n, c: new Set([1]) }))).not.toThrow();
  });
});

describe("deep and heterogeneous nesting", () => {
  it("round-trips maps of sets of arrays of objects with dates and bigints", () => {
    const value = new Map<string, Set<unknown>>([
      ["group", new Set([[{ at: new Date(0), n: 9n }], { nested: new Map([["x", [1, 2, 3]]]) }])],
    ]);
    expect(roundTrip(value)).toEqual(value);
  });

  it("handles very deep nesting", () => {
    let deep: unknown = { leaf: 1n };
    for (let i = 0; i < 500; i++) deep = { level: i, child: deep, tag: new Set([i]) };
    expect(roundTrip(deep)).toEqual(deep);
  });

  it("throws MaxDepthError past the configured limit, with a path", () => {
    const shallow = new Serde({ maxDepth: 5 });
    let deep: unknown = 1;
    for (let i = 0; i < 20; i++) deep = { child: deep };
    try {
      shallow.serialize(deep);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MaxDepthError);
      expect((err as MaxDepthError).path).toContain("$");
    }
  });
});

describe("custom codecs", () => {
  class DecimalCodec extends ClassScalarCodec<Decimal, string> {
    readonly name = "Decimal";
    readonly ctor = Decimal;
    encode(d: Decimal) {
      return d.toString();
    }
    decode(s: string) {
      return new Decimal(s);
    }
  }

  it("round-trips a registered class (decimal.js), even deeply nested", () => {
    const serde = new Serde({ codecs: [new DecimalCodec()] });
    const value = { items: [{ price: new Decimal("9.99") }], total: new Decimal("19.98") };
    const back = serde.deserialize<typeof value>(serde.serialize(value));
    expect(back.total).toBeInstanceOf(Decimal);
    expect(back.total.equals(new Decimal("19.98"))).toBe(true);
    expect(back.items[0]!.price.equals(new Decimal("9.99"))).toBe(true);
  });

  it("lets a custom codec override a built-in by name", () => {
    class EpochDateCodec extends ClassScalarCodec<Date, number> {
      readonly name = "Date";
      readonly ctor = Date;
      encode(d: Date) {
        return d.getTime();
      }
      decode(n: number) {
        return new Date(n);
      }
    }
    const serde = new Serde({ codecs: [new EpochDateCodec()] });
    const wire = serde.serialize(new Date(1000));
    expect(wire).toContain("1000"); // epoch number, not an ISO string
    expect(serde.deserialize<Date>(wire).getTime()).toBe(1000);
  });

  it("supports codecs that recurse via the context", () => {
    class Wrapper {
      constructor(readonly inner: unknown) {}
    }
    const wrapperCodec = defineCodec<Wrapper, JsonValue>({
      name: "Wrapper",
      ctor: Wrapper,
      serialize: (w, ctx: EncodeContext) => ctx.encode(w.inner),
      deserialize: (data, ctx: DecodeContext) => new Wrapper(ctx.decode(data)),
    });

    const serde = new Serde({ codecs: [wrapperCodec] });
    const value = new Wrapper(new Map([["k", new Date(0)]]));
    const back = serde.deserialize<Wrapper>(serde.serialize(value));
    expect(back).toBeInstanceOf(Wrapper);
    expect(back.inner).toEqual(new Map([["k", new Date(0)]]));
  });
});

describe("versioning / backward compatibility", () => {
  class Money {
    constructor(
      readonly cents: number,
      readonly currency: string,
    ) {}
  }
  interface MoneyV2 {
    cents: number;
    currency: string;
  }

  class MoneyCodec extends VersionedCodec<Money, MoneyV2> {
    readonly name = "Money";
    readonly ctor = Money;
    readonly version = 2;
    write(m: Money): MoneyV2 {
      return { cents: m.cents, currency: m.currency };
    }
    read(d: MoneyV2): Money {
      return new Money(d.cents, d.currency);
    }
    protected override upgrade(old: JsonValue, from: number): MoneyV2 {
      if (from === 1) return { cents: (old as number) * 100, currency: "USD" };
      return old as MoneyV2;
    }
  }

  it("reads current-version payloads", () => {
    const serde = new Serde({ codecs: [new MoneyCodec()] });
    const back = serde.deserialize<Money>(serde.serialize(new Money(999, "EUR")));
    expect(back).toEqual(new Money(999, "EUR"));
  });

  it("migrates a legacy v1 payload forward", () => {
    const serde = new Serde({ codecs: [new MoneyCodec()] });
    // Simulate a payload written by v1: bare dollars, no version tag.
    const legacy = JSON.stringify({ $brokkr: "Money", v: 5 });
    const back = serde.deserialize<Money>(legacy);
    expect(back).toEqual(new Money(500, "USD"));
  });
});

describe("errors", () => {
  it("reports UnknownTypeError with a precise path", () => {
    class Widget {}
    try {
      serialize({ a: { b: [{ w: new Widget() }] } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownTypeError);
      expect((err as UnknownTypeError).typeName).toBe("Widget");
      expect((err as UnknownTypeError).path).toBe("$.a.b[0].w");
    }
  });

  it("rejects symbols and functions", () => {
    expect(() => serialize(Symbol("x"))).toThrow(UnsupportedTypeError);
    expect(() => serialize(() => 1)).toThrow(UnsupportedTypeError);
  });

  it("detects circular references with a path", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    try {
      serialize(a);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CircularReferenceError);
      expect((err as CircularReferenceError).path).toBe("$.self");
    }
  });

  it("throws UnknownTagError when decoding a tag with no codec", () => {
    expect(() => deserialize(JSON.stringify({ $brokkr: "Nope", v: 1 }))).toThrow(UnknownTagError);
  });
});

describe("edge cases", () => {
  it("escapes plain objects that literally contain the sentinel key", () => {
    const tricky = { $brokkr: "Date", v: "not really a date", extra: 1 };
    expect(roundTrip(tricky)).toEqual(tricky);
  });

  it("clone produces an independent deep copy", () => {
    const original = { list: [new Set([1])], when: new Date(0) };
    const copy = clone(original);
    expect(copy).toEqual(original);
    (copy.list[0] as Set<number>).add(2);
    expect((original.list[0] as Set<number>).has(2)).toBe(false);
  });

  it("preserves shared (non-cyclic) references as duplicates", () => {
    const shared = { n: 1 };
    const back = roundTrip({ a: shared, b: shared });
    expect(back.a).toEqual(back.b);
    expect(back.a).not.toBe(back.b); // structural copy, not identity
  });
});
