import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  ClassScalarCodec,
  CircularReferenceError,
  CodecError,
  defineCodec,
  MaxDepthError,
  Serde,
  SERDE,
  SerdeError,
  UnknownTagError,
  UnknownTypeError,
  UnsupportedTypeError,
  VersionedCodec,
  clone,
  decode,
  deserialize,
  encode,
  provideSerde,
  serialize,
} from "./index";
import type { DecodeContext, EncodeContext, JsonValue } from "./index";
import {
  dayjsCodec,
  decimalCodec,
  errorCodec,
  luxonDateTimeCodec,
  nativeCodecs,
  stringableCodec,
  type Stringable,
} from "./index";

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

    const map = new Map<string, number>([
      ["a", 1],
      ["b", 2],
    ]);
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

  it("dispatches via a custom `match` predicate (not just ctor)", () => {
    class Temperature {
      constructor(readonly celsius: number) {}
    }
    const tempCodec = defineCodec<Temperature, number>({
      name: "Temperature",
      match: (value) => value instanceof Temperature, // predicate path, no ctor
      serialize: (t) => t.celsius,
      deserialize: (c) => new Temperature(c),
    });

    const serde = new Serde({ codecs: [tempCodec] });
    const back = serde.deserialize<Temperature>(serde.serialize(new Temperature(21)));
    expect(back).toBeInstanceOf(Temperature);
    expect(back.celsius).toBe(21);
  });
});

describe("versioning / backward compatibility", () => {
  class Money {
    constructor(
      readonly cents: number,
      readonly currency: string,
    ) {}
  }
  // A `type` (not `interface`) so it satisfies the JsonValue index-signature constraint.
  type MoneyV2 = { cents: number; currency: string };

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
      return old as unknown as MoneyV2;
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

describe("empty and trivial containers", () => {
  it("round-trips empty containers preserving their type", () => {
    expect(roundTrip(new Map())).toBeInstanceOf(Map);
    expect(roundTrip(new Map()).size).toBe(0);
    expect(roundTrip(new Set())).toBeInstanceOf(Set);
    expect(roundTrip(new Set()).size).toBe(0);
    expect(roundTrip([])).toEqual([]);
    expect(roundTrip({})).toEqual({});
    expect(roundTrip("")).toBe("");
  });

  it("round-trips nested empty containers", () => {
    const value = { a: new Map(), b: new Set(), c: [], d: {} };
    const back = roundTrip(value);
    expect(back.a).toBeInstanceOf(Map);
    expect(back.b).toBeInstanceOf(Set);
    expect(back.c).toEqual([]);
    expect(back.d).toEqual({});
  });
});

describe("Map and Set worst cases", () => {
  it("preserves non-string Map keys (number, bigint, object, Date)", () => {
    expect([...roundTrip(new Map<number, string>([[1, "a"]])).entries()]).toEqual([[1, "a"]]);
    expect([...roundTrip(new Map<bigint, string>([[9n, "a"]])).entries()]).toEqual([[9n, "a"]]);
    expect([...roundTrip(new Map<object, number>([[{ id: 1 }, 5]])).entries()]).toEqual([
      [{ id: 1 }, 5],
    ]);
    expect([...roundTrip(new Map<Date, string>([[new Date(0), "epoch"]])).entries()]).toEqual([
      [new Date(0), "epoch"],
    ]);
  });

  it("preserves Map insertion order", () => {
    const m = new Map([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
    expect([...roundTrip(m).keys()]).toEqual(["b", "a", "c"]);
  });

  it("keeps Set identity semantics (dedupe by reference, not value)", () => {
    expect(roundTrip(new Set([1, 1, 1])).size).toBe(1);
    // Two structurally-equal but distinct objects remain two entries.
    expect(roundTrip(new Set([{ x: 1 }, { x: 1 }])).size).toBe(2);
  });

  it("round-trips a Map whose values are Sets of Maps", () => {
    const value = new Map([["g", new Set([new Map([["k", new Date(0)]])])]]);
    expect(roundTrip(value)).toEqual(value);
  });
});

describe("number and bigint worst cases", () => {
  it("preserves negative zero", () => {
    expect(Object.is(roundTrip(-0), -0)).toBe(true);
    expect(Object.is(roundTrip({ z: -0 }).z, -0)).toBe(true);
    expect(Object.is(roundTrip(0), 0)).toBe(true); // positive zero stays positive
  });

  it("preserves integer boundaries", () => {
    expect(roundTrip(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(roundTrip(Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);
    expect(roundTrip(Number.EPSILON)).toBe(Number.EPSILON);
  });

  it("preserves non-finite numbers inside containers", () => {
    const value = { list: [NaN, Infinity, -Infinity], set: new Set([NaN]) };
    const back = roundTrip(value);
    expect(back.list[0]).toBeNaN();
    expect(back.list[1]).toBe(Infinity);
    expect(back.list[2]).toBe(-Infinity);
    expect([...back.set][0]).toBeNaN();
  });

  it("preserves bigints beyond Number's safe range", () => {
    expect(roundTrip(0n)).toBe(0n);
    expect(roundTrip(-123n)).toBe(-123n);
    const huge = 2n ** 200n;
    expect(roundTrip(huge)).toBe(huge);
  });

  it("surfaces a tampered bigint payload as a SerdeError", () => {
    expect(() => deserialize(JSON.stringify({ $brokkr: "bigint", v: "not-a-number" }))).toThrow(
      SerdeError,
    );
  });
});

describe("undefined placement and array holes", () => {
  it("preserves undefined array elements (JSON would turn them into null)", () => {
    const back = roundTrip([1, undefined, 3]);
    expect(back).toEqual([1, undefined, 3]);
    expect(back[1]).toBeUndefined();
    expect(back.length).toBe(3);
  });

  it("materializes sparse array holes as undefined", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3];
    const back = roundTrip(sparse);
    expect(back.length).toBe(3);
    expect(back[1]).toBeUndefined();
  });

  it("distinguishes undefined from null on object properties", () => {
    const back = roundTrip({ a: undefined, b: null });
    expect("a" in back).toBe(true);
    expect(back.a).toBeUndefined();
    expect(back.b).toBeNull();
  });
});

describe("Date worst cases", () => {
  it("round-trips an invalid Date instead of throwing", () => {
    const bad = new Date("not a date");
    const back = roundTrip(bad);
    expect(back).toBeInstanceOf(Date);
    expect(Number.isNaN(back.getTime())).toBe(true);
  });

  it("preserves millisecond precision and the epoch", () => {
    const d = new Date("2026-07-01T12:34:56.789Z");
    expect(roundTrip(d).getTime()).toBe(d.getTime());
    expect(roundTrip(new Date(0)).getTime()).toBe(0);
  });
});

describe("string worst cases", () => {
  it("round-trips unicode, emoji, control characters and escapes", () => {
    const value = {
      emoji: "🔥🛠️",
      unicode: "café — naïve — Ω",
      control: "line1\nline2\ttab null",
      quotes: 'he said "hi" and \\ escaped',
    };
    expect(roundTrip(value)).toEqual(value);
  });
});

describe("unusual object keys", () => {
  it("round-trips a literal __proto__ key without polluting the prototype", () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true},"safe":1}') as Record<string, unknown>;
    const back = roundTrip(evil);
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(back, "__proto__")).toBe(true);
    expect(back.safe).toBe(1);
    // No global prototype pollution occurred.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("escapes objects whose keys collide with the wire format", () => {
    expect(roundTrip({ $brokkr: 1, v: 2, ver: 3 })).toEqual({ $brokkr: 1, v: 2, ver: 3 });
    expect(roundTrip({ nested: { $brokkr: "Date", v: "x" } })).toEqual({
      nested: { $brokkr: "Date", v: "x" },
    });
  });

  it("handles numeric-string and symbol-ish keys and reports readable paths", () => {
    expect(roundTrip({ "0": "a", "weird key!": "b" })).toEqual({ "0": "a", "weird key!": "b" });
    try {
      serialize({ "weird key!": [() => 1] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedTypeError);
      expect((err as UnsupportedTypeError).path).toBe('$["weird key!"][0]');
    }
  });

  it("drops symbol-keyed properties (matching JSON semantics)", () => {
    const back = roundTrip({ [Symbol("s")]: 1, kept: 2 } as Record<string, number>);
    expect(back).toEqual({ kept: 2 });
  });
});

describe("circular references (worst cases)", () => {
  it("detects a cycle through an array with a precise path", () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    try {
      serialize({ data: arr });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CircularReferenceError);
      expect((err as CircularReferenceError).path).toBe("$.data[2]");
    }
  });

  it("detects a cycle through a Map value", () => {
    const m = new Map<string, unknown>();
    m.set("self", m);
    expect(() => serialize(m)).toThrow(CircularReferenceError);
  });

  it("does not flag a diamond (shared but acyclic) structure", () => {
    const leaf = { v: 1 };
    expect(() => serialize({ a: leaf, b: { c: leaf } })).not.toThrow();
  });
});

describe("depth limits (boundaries)", () => {
  function nest(levels: number): unknown {
    let value: unknown = 0;
    for (let i = 0; i < levels; i++) value = { child: value };
    return value;
  }

  it("allows depth up to the limit and rejects one level deeper", () => {
    const md = 10;
    const serde = new Serde({ maxDepth: md });
    expect(() => serde.serialize(nest(md))).not.toThrow();
    expect(() => serde.serialize(nest(md + 1))).toThrow(MaxDepthError);
  });

  it("enforces maxDepth on the decode side too", () => {
    const wire = new Serde({ maxDepth: 1000 }).serialize(nest(30));
    const shallow = new Serde({ maxDepth: 5 });
    expect(() => shallow.deserialize(wire)).toThrow(MaxDepthError);
  });
});

describe("registry operations", () => {
  const decimalCodec = defineCodec<Decimal, string>({
    name: "Decimal",
    ctor: Decimal,
    serialize: (d) => d.toString(),
    deserialize: (s) => new Decimal(s),
  });

  it("reports and mutates the codec set", () => {
    const serde = new Serde();
    expect(serde.has("Date")).toBe(true);
    expect(serde.codecs()).toEqual(expect.arrayContaining(["Date", "Map", "Set", "RegExp", "URL"]));
    expect(serde.unregister("Date")).toBe(true);
    expect(serde.has("Date")).toBe(false);
    expect(() => serde.serialize(new Date())).toThrow(UnknownTypeError);
    expect(serde.unregister("Nonexistent")).toBe(false);
  });

  it("rejects reserved names and codecs with no dispatch", () => {
    const serde = new Serde();
    // "bigint" is a reserved inline tag.
    expect(() =>
      serde.register(
        defineCodec({
          name: "bigint",
          ctor: Date,
          serialize: () => 0,
          deserialize: () => new Date(),
        }),
      ),
    ).toThrow(SerdeError);
    // Neither ctor nor match → no way to dispatch.
    expect(() =>
      serde.register(defineCodec({ name: "NoDispatch", serialize: () => 1, deserialize: () => 1 })),
    ).toThrow(SerdeError);
  });

  it("extend() adds codecs without mutating the parent", () => {
    const parent = new Serde();
    const child = parent.extend({ codecs: [decimalCodec] });
    expect(child.has("Decimal")).toBe(true);
    expect(parent.has("Decimal")).toBe(false);
    expect(child.has("Date")).toBe(true); // inherited built-ins
  });
});

describe("codec failure handling", () => {
  class Boom {}

  it("wraps a serialize-time throw in CodecError with cause and path", () => {
    const serde = new Serde({
      codecs: [
        defineCodec<Boom, null>({
          name: "Boom",
          ctor: Boom,
          serialize: () => {
            throw new Error("kaboom");
          },
          deserialize: () => new Boom(),
        }),
      ],
    });
    try {
      serde.serialize({ a: { b: new Boom() } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CodecError);
      expect((err as CodecError).codecName).toBe("Boom");
      expect((err as CodecError).phase).toBe("serialize");
      expect((err as CodecError).path).toBe("$.a.b");
      expect((err as CodecError).cause).toBeInstanceOf(Error);
    }
  });

  it("wraps a deserialize-time throw in CodecError", () => {
    const serde = new Serde({
      codecs: [
        defineCodec<Boom, number>({
          name: "Boom",
          ctor: Boom,
          serialize: () => 1,
          deserialize: () => {
            throw new Error("nope");
          },
        }),
      ],
    });
    const wire = serde.serialize(new Boom());
    expect(() => serde.deserialize(wire)).toThrow(CodecError);
  });

  it("does not double-wrap a SerdeError raised inside a codec — the deep path survives", () => {
    class Unknown {}
    const serde = new Serde({
      codecs: [
        defineCodec<Boom, JsonValue>({
          name: "Boom",
          ctor: Boom,
          // Recurses into an unserializable value via the context.
          serialize: (_v, ctx: EncodeContext) => ctx.encode(new Unknown(), "payload"),
          deserialize: () => new Boom(),
        }),
      ],
    });
    try {
      serde.serialize(new Boom());
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownTypeError); // not CodecError
      expect((err as UnknownTypeError).path).toContain("payload");
    }
  });
});

describe("encode / decode without stringify", () => {
  it("passes primitives through and boxes specials", () => {
    expect(encode(5)).toBe(5);
    expect(encode("x")).toBe("x");
    expect(encode(true)).toBe(true);
    expect(decode(encode(undefined))).toBeUndefined();
  });

  it("returns a JSON-safe tree that JSON.stringify accepts and decode reverses", () => {
    const value = { d: new Date(0), s: new Set([1n]), m: new Map([["k", 2]]) };
    const tree = encode(value);
    expect(() => JSON.stringify(tree)).not.toThrow();
    expect(decode(tree)).toEqual(value);
  });
});

describe("DI helpers", () => {
  it("provideSerde returns a class-token provider and SERDE is a symbol", () => {
    const provider = provideSerde({
      codecs: [
        defineCodec<Decimal, string>({
          name: "Decimal",
          ctor: Decimal,
          serialize: (d) => d.toString(),
          deserialize: (s) => new Decimal(s),
        }),
      ],
    });
    expect(provider.provide).toBe(Serde);
    expect(provider.useValue).toBeInstanceOf(Serde);
    expect(provider.useValue.has("Decimal")).toBe(true);
    expect(typeof SERDE).toBe("symbol");
  });
});

describe("large / stress structures", () => {
  it("round-trips a wide array of mixed special types", () => {
    const wide = Array.from({ length: 5000 }, (_, i) => (i % 2 ? BigInt(i) : new Date(i)));
    const back = roundTrip(wide);
    expect(back.length).toBe(5000);
    expect(back[1]).toBe(1n);
    expect(back[2]).toEqual(new Date(2));
  });

  it("round-trips a broad, deeply heterogeneous object", () => {
    const value = {
      when: new Date("2026-01-01"),
      ids: new Set([1n, 2n, 3n]),
      index: new Map<string, unknown>([
        ["a", [{ n: NaN }, undefined, /re/g]],
        ["b", new URL("https://example.com")],
      ]),
      flag: -0,
    };
    expect(roundTrip(value)).toEqual(value);
  });
});

describe("preset codecs", () => {
  it("stringableCodec round-trips any toString/new-from-string value class", () => {
    class Ratio {
      constructor(private readonly text: string) {}
      toString(): string {
        return this.text;
      }
    }
    const serde = new Serde({ codecs: [stringableCodec("Ratio", Ratio)] });
    const back = serde.deserialize<{ r: Stringable }>(serde.serialize({ r: new Ratio("3/4") }));
    expect(back.r).toBeInstanceOf(Ratio);
    expect(String(back.r)).toBe("3/4");
  });

  it("decimalCodec round-trips decimal.js values without precision loss", () => {
    const serde = new Serde({ codecs: [decimalCodec(Decimal)] });
    const back = serde.deserialize<{ n: Stringable }>(
      serde.serialize({ n: new Decimal("0.1").plus(new Decimal("0.2")) }),
    );
    expect(back.n).toBeInstanceOf(Decimal);
    expect(String(back.n)).toBe("0.3"); // exact, unlike 0.1 + 0.2 in float
  });

  it("nativeCodecs round-trip typed arrays, ArrayBuffer and URLSearchParams", () => {
    const serde = new Serde({ codecs: [...nativeCodecs] });

    const u8 = new Uint8Array([0, 1, 2, 255]);
    expect(serde.deserialize<Uint8Array>(serde.serialize(u8))).toEqual(u8);

    const f64 = new Float64Array([1.5, -2.25, Math.PI]);
    expect(serde.deserialize<Float64Array>(serde.serialize(f64))).toEqual(f64);

    const b64 = new BigInt64Array([1n, -2n, 9007199254740993n]);
    expect(serde.deserialize<BigInt64Array>(serde.serialize(b64))).toEqual(b64);

    const buffer = new Uint8Array([9, 8, 7]).buffer;
    const backBuffer = serde.deserialize<ArrayBuffer>(serde.serialize(buffer));
    expect(new Uint8Array(backBuffer)).toEqual(new Uint8Array([9, 8, 7]));

    const params = new URLSearchParams("a=1&b=2");
    expect(serde.deserialize<URLSearchParams>(serde.serialize(params)).toString()).toBe("a=1&b=2");
  });

  it("errorCodec round-trips Errors and preserves a subclass name", () => {
    const serde = new Serde({ codecs: [errorCodec] });
    const back = serde.deserialize<Error>(serde.serialize(new TypeError("boom")));
    expect(back).toBeInstanceOf(Error);
    expect(back.name).toBe("TypeError");
    expect(back.message).toBe("boom");
  });

  it("luxonDateTimeCodec wires up against a Luxon-shaped class", () => {
    // Stand-in for Luxon's DateTime so the test needs no dependency.
    class FakeDateTime {
      constructor(readonly iso: string) {}
      static isDateTime(value: unknown): boolean {
        return value instanceof FakeDateTime;
      }
      static fromISO(text: string): FakeDateTime {
        return new FakeDateTime(text);
      }
      toISO(): string {
        return this.iso;
      }
    }
    const serde = new Serde({ codecs: [luxonDateTimeCodec(FakeDateTime)] });
    const back = serde.deserialize(serde.serialize(new FakeDateTime("2026-07-01T00:00:00.000Z")));
    expect(back).toBeInstanceOf(FakeDateTime);
    expect((back as FakeDateTime).iso).toBe("2026-07-01T00:00:00.000Z");
  });

  it("dayjsCodec wires up against a Day.js-shaped factory", () => {
    type FakeDay = { toISOString(): string; __day: true };
    const fakeDayjs = (value?: string): FakeDay => ({
      toISOString: () => value ?? "",
      __day: true,
    });
    fakeDayjs.isDayjs = (value: unknown): boolean =>
      typeof value === "object" && value !== null && "__day" in value;

    const serde = new Serde({ codecs: [dayjsCodec(fakeDayjs)] });
    const iso = "2026-07-01T00:00:00.000Z";
    const back = serde.deserialize<FakeDay>(serde.serialize(fakeDayjs(iso)));
    expect(back.toISOString()).toBe(iso);
  });
});
