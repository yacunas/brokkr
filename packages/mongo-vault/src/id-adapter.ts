import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { defineCodec, type Codec } from "@brokkr/serde-engine";

/**
 * Everything the vault needs to know about your identity type, in one place. The
 * vault never touches `_id` or an `ObjectId` directly — it always goes through
 * this. Ship a default, or supply your own to use a custom id (e.g. a typed
 * value object). See {@link stringObjectIdAdapter} (the default).
 */
export interface IdAdapter<ID> {
  /** Domain id → the value stored in Mongo's `_id`. */
  toStorage(id: ID): unknown;
  /** Mongo `_id` → domain id. */
  fromStorage(raw: unknown): ID;
  /** Mint a new id when `create` is called without one. */
  generate(): ID;
  /** Runtime guard so the vault can validate inputs early. */
  is(value: unknown): value is ID;
  /**
   * serde-engine codec so ids survive inside opaque cursors. Only needed for
   * non-JSON-native ids (a plain string id needs none).
   */
  codec?: Codec<ID>;
  /** Id ⇄ string, for GraphQL `ID` scalars and logs. */
  stringify(id: ID): string;
  parse(text: string): ID;
}

/**
 * **Default.** Domain id is a hex `string`; stored as a native Mongo `ObjectId`.
 * Best of both: efficient indexed storage, but the domain/API layer only ever
 * sees a plain string (maps straight onto GraphQL's built-in `ID` scalar, and
 * Apollo/Relay cache normalization "just works").
 */
export const stringObjectIdAdapter: IdAdapter<string> = {
  toStorage: (id) => new Types.ObjectId(id),
  fromStorage: (raw) => (raw instanceof Types.ObjectId ? raw.toHexString() : String(raw)),
  generate: () => new Types.ObjectId().toHexString(),
  is: (value): value is string => typeof value === "string" && Types.ObjectId.isValid(value),
  stringify: (id) => id,
  parse: (text) => text,
};

/** Domain id is a native Mongoose `ObjectId`. Opt in when you need ObjectId semantics. */
export const objectIdAdapter: IdAdapter<Types.ObjectId> = {
  toStorage: (id) => id,
  fromStorage: (raw) =>
    raw instanceof Types.ObjectId ? raw : new Types.ObjectId(String(raw)),
  generate: () => new Types.ObjectId(),
  is: (value): value is Types.ObjectId => value instanceof Types.ObjectId,
  codec: defineCodec<Types.ObjectId, string>({
    name: "ObjectId",
    match: (value) => value instanceof Types.ObjectId,
    serialize: (id) => id.toHexString(),
    deserialize: (hex) => new Types.ObjectId(hex),
  }),
  stringify: (id) => id.toHexString(),
  parse: (text) => new Types.ObjectId(text),
};

/** Domain id is a UUID `string`, stored verbatim as a string `_id`. */
export const uuidAdapter: IdAdapter<string> = {
  toStorage: (id) => id,
  fromStorage: (raw) => String(raw),
  generate: () => randomUUID(),
  is: (value): value is string => typeof value === "string",
  stringify: (id) => id,
  parse: (text) => text,
};
