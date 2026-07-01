/**
 * Ready-made codecs for common types.
 *
 * Two groups live here:
 *
 * 1. **Factories for third-party classes** (`decimal.js`, `bignumber.js`, Luxon,
 *    Day.js, MongoDB `ObjectId`, …). serde-engine has zero dependencies, so you
 *    pass the library's class in and get a codec back — nothing is bundled.
 *
 * 2. **Native codecs** for built-in types that need no dependency at all
 *    (typed arrays, `ArrayBuffer`, `URLSearchParams`, `Error`). These are plain
 *    codec instances you can register directly, or via the {@link nativeCodecs}
 *    bundle.
 *
 * None of these are registered by default — opt in per `Serde` instance:
 *
 * @example
 * import Decimal from "decimal.js";
 * import { Serde, decimalCodec, nativeCodecs } from "@brokkr/serde-engine";
 *
 * const serde = new Serde({ codecs: [decimalCodec(Decimal), ...nativeCodecs] });
 */

import { type Codec, defineCodec } from "./codec";

// ---------------------------------------------------------------------------
// Factories for third-party value classes
// ---------------------------------------------------------------------------

/** Any value that flattens to a string and can be rebuilt from one. */
export interface Stringable {
  toString(): string;
}

/**
 * Generic codec for value classes that round-trip through their string form —
 * `value.toString()` out, `new Ctor(string)` back in. This one factory covers a
 * huge family of libraries (decimal.js, bignumber.js, big.js, bson `ObjectId`,
 * and most immutable value objects).
 *
 * @example
 * const codec = stringableCodec("Money", Money); // Money#toString / new Money(str)
 */
export function stringableCodec<T extends Stringable>(
  name: string,
  ctor: new (value: string) => T,
): Codec<T, string> {
  return defineCodec<T, string>({
    name,
    ctor,
    serialize: (value) => value.toString(),
    deserialize: (data) => new ctor(data),
  });
}

/** Codec for decimal.js `Decimal`. Pass the `Decimal` class in. */
export const decimalCodec = (
  Decimal: new (value: string) => Stringable,
): Codec<Stringable, string> => stringableCodec("Decimal", Decimal);

/** Codec for bignumber.js `BigNumber`. Pass the `BigNumber` class in. */
export const bigNumberCodec = (
  BigNumber: new (value: string) => Stringable,
): Codec<Stringable, string> => stringableCodec("BigNumber", BigNumber);

/** Codec for big.js `Big`. Pass the `Big` class in. */
export const bigCodec = (Big: new (value: string) => Stringable): Codec<Stringable, string> =>
  stringableCodec("Big", Big);

/** Codec for MongoDB / bson `ObjectId`. Pass the `ObjectId` class in. */
export const objectIdCodec = (
  ObjectId: new (value: string) => Stringable,
): Codec<Stringable, string> => stringableCodec("ObjectId", ObjectId);

/** Minimal shape of Luxon's `DateTime` class needed to build a codec. */
export interface LuxonDateTimeClass {
  isDateTime(value: unknown): boolean;
  fromISO(text: string): unknown;
}

/** Codec for Luxon `DateTime` (ISO-8601 on the wire). Pass the `DateTime` class in. */
export function luxonDateTimeCodec(DateTime: LuxonDateTimeClass): Codec {
  return defineCodec<{ toISO(): string | null }, string>({
    name: "LuxonDateTime",
    match: (value) => DateTime.isDateTime(value),
    serialize: (value) => value.toISO() ?? "",
    deserialize: (text) => DateTime.fromISO(text) as { toISO(): string | null },
  });
}

/** Minimal shape of the Day.js factory needed to build a codec. */
export interface DayjsFactory {
  (value?: string): unknown;
  isDayjs(value: unknown): boolean;
}

/** Codec for Day.js `Dayjs` (ISO-8601 on the wire). Pass the `dayjs` factory in. */
export function dayjsCodec(dayjs: DayjsFactory): Codec {
  return defineCodec<{ toISOString(): string }, string>({
    name: "Dayjs",
    match: (value) => dayjs.isDayjs(value),
    serialize: (value) => value.toISOString(),
    deserialize: (text) => dayjs(text) as { toISOString(): string },
  });
}

// ---------------------------------------------------------------------------
// Native codecs (zero dependency)
// ---------------------------------------------------------------------------

/** Build a codec for a number-backed typed array, stored as a plain number array. */
export function typedArrayCodec<T extends ArrayLike<number>>(
  name: string,
  ctor: new (values: ArrayLike<number>) => T,
): Codec<T, number[]> {
  return defineCodec<T, number[]>({
    name,
    ctor,
    serialize: (value) => Array.from(value as ArrayLike<number>),
    deserialize: (data) => new ctor(data),
  });
}

/** Build a codec for a bigint-backed typed array, stored as decimal strings. */
export function bigIntArrayCodec<T extends ArrayLike<bigint>>(
  name: string,
  ctor: new (values: ArrayLike<bigint>) => T,
): Codec<T, string[]> {
  return defineCodec<T, string[]>({
    name,
    ctor,
    serialize: (value) => Array.from(value as ArrayLike<bigint>, (x) => x.toString()),
    deserialize: (data) => new ctor(data.map((s) => BigInt(s))),
  });
}

export const uint8ArrayCodec = typedArrayCodec("Uint8Array", Uint8Array);
export const int8ArrayCodec = typedArrayCodec("Int8Array", Int8Array);
export const uint8ClampedArrayCodec = typedArrayCodec("Uint8ClampedArray", Uint8ClampedArray);
export const int16ArrayCodec = typedArrayCodec("Int16Array", Int16Array);
export const uint16ArrayCodec = typedArrayCodec("Uint16Array", Uint16Array);
export const int32ArrayCodec = typedArrayCodec("Int32Array", Int32Array);
export const uint32ArrayCodec = typedArrayCodec("Uint32Array", Uint32Array);
export const float32ArrayCodec = typedArrayCodec("Float32Array", Float32Array);
export const float64ArrayCodec = typedArrayCodec("Float64Array", Float64Array);
export const bigInt64ArrayCodec = bigIntArrayCodec("BigInt64Array", BigInt64Array);
export const bigUint64ArrayCodec = bigIntArrayCodec("BigUint64Array", BigUint64Array);

/** `ArrayBuffer` ⇄ a byte-value array. */
export const arrayBufferCodec: Codec<ArrayBuffer, number[]> = defineCodec<ArrayBuffer, number[]>({
  name: "ArrayBuffer",
  ctor: ArrayBuffer,
  serialize: (buffer) => Array.from(new Uint8Array(buffer)),
  deserialize: (data) => new Uint8Array(data).buffer,
});

/** `URLSearchParams` ⇄ its query string. */
export const urlSearchParamsCodec: Codec<URLSearchParams, string> = defineCodec<
  URLSearchParams,
  string
>({
  name: "URLSearchParams",
  ctor: URLSearchParams,
  serialize: (params) => params.toString(),
  deserialize: (text) => new URLSearchParams(text),
});

/** JSON-safe projection of an `Error`. `stack` is best-effort and may be absent. */
export type ErrorShape = { name: string; message: string; stack?: string };

/**
 * `Error` (and any subclass) ⇄ `{ name, message, stack? }`. Matches by
 * `instanceof Error`, so a `TypeError` round-trips with its `name` preserved,
 * though it is rebuilt as a base `Error`.
 */
export const errorCodec: Codec<Error, ErrorShape> = defineCodec<Error, ErrorShape>({
  name: "Error",
  match: (value) => value instanceof Error,
  serialize: (error) => ({
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  }),
  deserialize: (data) => {
    const error = new Error(data.message);
    error.name = data.name;
    if (data.stack) error.stack = data.stack;
    return error;
  },
});

/** Every number- and bigint-backed typed-array codec. */
export const typedArrayCodecs: readonly Codec[] = [
  uint8ArrayCodec,
  int8ArrayCodec,
  uint8ClampedArrayCodec,
  int16ArrayCodec,
  uint16ArrayCodec,
  int32ArrayCodec,
  uint32ArrayCodec,
  float32ArrayCodec,
  float64ArrayCodec,
  bigInt64ArrayCodec,
  bigUint64ArrayCodec,
];

/** A convenient bundle of the dependency-free native codecs. */
export const nativeCodecs: readonly Codec[] = [
  ...typedArrayCodecs,
  arrayBufferCodec,
  urlSearchParamsCodec,
];
