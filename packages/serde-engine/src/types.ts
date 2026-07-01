/**
 * The subset of values that survive `JSON.stringify` unchanged. Every codec's
 * `serialize` must return one of these; `deserialize` receives one back.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Handed to a codec's `serialize` so it can recurse into nested values. */
export interface EncodeContext {
  /**
   * Encode a nested value through the full engine (codecs, cycle + depth
   * tracking). `label` is used only to make error paths readable.
   */
  encode(value: unknown, label?: string): JsonValue;
}

/** Handed to a codec's `deserialize` so it can recurse into nested nodes. */
export interface DecodeContext {
  /** Decode a nested node produced by the matching codec's `serialize`. */
  decode(node: JsonValue, label?: string): unknown;
}

/** Extra information passed to `deserialize`, notably the payload's format version. */
export interface DecodeMeta {
  /** The `version` the value was serialized with (defaults to 1 for legacy payloads). */
  readonly version: number;
}
