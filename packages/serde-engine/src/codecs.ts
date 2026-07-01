import { ClassCodec, ClassScalarCodec, type Codec } from "./codec";
import type { DecodeContext, EncodeContext, JsonValue } from "./types";

/** `Date` ⇄ ISO-8601 string. */
class DateCodec extends ClassScalarCodec<Date, string> {
  readonly name = "Date";
  readonly ctor = Date;
  encode(value: Date): string {
    return value.toISOString();
  }
  decode(data: string): Date {
    return new Date(data);
  }
}

/** `RegExp` ⇄ `[source, flags]`. */
class RegExpCodec extends ClassScalarCodec<RegExp, [string, string]> {
  readonly name = "RegExp";
  readonly ctor = RegExp;
  encode(value: RegExp): [string, string] {
    return [value.source, value.flags];
  }
  decode(data: [string, string]): RegExp {
    return new RegExp(data[0], data[1]);
  }
}

/** `URL` ⇄ href string. */
class UrlCodec extends ClassScalarCodec<URL, string> {
  readonly name = "URL";
  readonly ctor = URL;
  encode(value: URL): string {
    return value.href;
  }
  decode(data: string): URL {
    return new URL(data);
  }
}

/** `Map` ⇄ array of `[key, value]` pairs; keys and values recurse through the engine. */
class MapCodec extends ClassCodec<Map<unknown, unknown>, [JsonValue, JsonValue][]> {
  readonly name = "Map";
  readonly ctor = Map;
  serialize(value: Map<unknown, unknown>, ctx: EncodeContext): [JsonValue, JsonValue][] {
    const out: [JsonValue, JsonValue][] = [];
    let i = 0;
    for (const [k, v] of value) {
      out.push([ctx.encode(k, `key[${i}]`), ctx.encode(v, `value[${i}]`)]);
      i++;
    }
    return out;
  }
  deserialize(data: [JsonValue, JsonValue][], ctx: DecodeContext): Map<unknown, unknown> {
    const out = new Map<unknown, unknown>();
    for (let i = 0; i < data.length; i++) {
      const pair = data[i]!;
      out.set(ctx.decode(pair[0], `key[${i}]`), ctx.decode(pair[1], `value[${i}]`));
    }
    return out;
  }
}

/** `Set` ⇄ array of items; items recurse through the engine. */
class SetCodec extends ClassCodec<Set<unknown>, JsonValue[]> {
  readonly name = "Set";
  readonly ctor = Set;
  serialize(value: Set<unknown>, ctx: EncodeContext): JsonValue[] {
    const out: JsonValue[] = [];
    let i = 0;
    for (const item of value) {
      out.push(ctx.encode(item, `item[${i}]`));
      i++;
    }
    return out;
  }
  deserialize(data: JsonValue[], ctx: DecodeContext): Set<unknown> {
    const out = new Set<unknown>();
    for (let i = 0; i < data.length; i++) {
      out.add(ctx.decode(data[i]!, `item[${i}]`));
    }
    return out;
  }
}

/**
 * The codecs every `Serde` instance starts with. Primitive-ish specials
 * (`bigint`, `undefined`, `NaN`, `±Infinity`) are handled inline by the engine
 * and are not listed here. Any of these can be overridden by registering another
 * codec with the same `name`.
 */
export const builtinCodecs: readonly Codec[] = [
  new DateCodec(),
  new MapCodec(),
  new SetCodec(),
  new RegExpCodec(),
  new UrlCodec(),
];
