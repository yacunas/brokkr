/**
 * @brokkr/serde-engine
 *
 * Structured, extensible, versioned serialization for TypeScript. Round-trips the
 * types `JSON` drops (`Date`, `Map`, `Set`, `RegExp`, `URL`, `BigInt`, `undefined`,
 * `NaN`, `±Infinity`), lets you teach it your own types via {@link Codec}s, tracks
 * error locations precisely, and is a plain injectable class. Zero dependencies.
 *
 * The default export surface is a shared {@link serde} instance plus standalone
 * {@link serialize}/{@link deserialize}/{@link encode}/{@link decode}/{@link clone}
 * bound to it — enough for most apps. Create your own {@link Serde} when you need
 * custom codecs, a different `maxDepth`, or dependency injection.
 */

export type { JsonValue, EncodeContext, DecodeContext, DecodeMeta } from "./types";
export {
  Codec,
  ClassCodec,
  ClassScalarCodec,
  VersionedCodec,
  defineCodec,
  type CodecSpec,
  type SerdeConfig,
} from "./codec";
export {
  SerdeError,
  UnsupportedTypeError,
  UnknownTypeError,
  UnknownTagError,
  CircularReferenceError,
  MaxDepthError,
  CodecError,
  type SerdePhase,
} from "./errors";
export { Serde, SERDE, provideSerde } from "./serde";
export {
  // third-party value classes (pass the class in — zero dependency)
  stringableCodec,
  decimalCodec,
  bigNumberCodec,
  bigCodec,
  objectIdCodec,
  luxonDateTimeCodec,
  dayjsCodec,
  type Stringable,
  type LuxonDateTimeClass,
  type DayjsFactory,
  // native types (register directly)
  typedArrayCodec,
  bigIntArrayCodec,
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
  arrayBufferCodec,
  urlSearchParamsCodec,
  errorCodec,
  type ErrorShape,
  // bundles
  typedArrayCodecs,
  nativeCodecs,
} from "./presets";

import { Serde } from "./serde";
import type { JsonValue } from "./types";

/** A ready-to-use {@link Serde} with the built-in codecs and default `maxDepth`. */
export const serde = new Serde();

/** Serialize a value to a JSON string using the shared {@link serde} instance. */
export const serialize = (value: unknown): string => serde.serialize(value);

/** Parse a string produced by {@link serialize} using the shared {@link serde}. */
export const deserialize = <T = unknown>(text: string): T => serde.deserialize<T>(text);

/** Encode a value to a JSON-safe tree using the shared {@link serde} instance. */
export const encode = (value: unknown): JsonValue => serde.encode(value);

/** Decode a tree produced by {@link encode} using the shared {@link serde}. */
export const decode = <T = unknown>(node: JsonValue): T => serde.decode<T>(node);

/** Deep-clone a value through the shared {@link serde} instance. */
export const clone = <T>(value: T): T => serde.clone(value);
