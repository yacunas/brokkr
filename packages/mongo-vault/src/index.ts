/**
 * @brokkr/mongo-vault
 *
 * A Mongoose-backed {@link Repository}: read + write, `find`/`list`, stable
 * cursor (keyset) pagination, and a pluggable serializer for shaping documents
 * into your domain entities. `mongoose` is a peer dependency — bring your own.
 */

import { Types, type FilterQuery, type Model } from "mongoose";
import type { CursorPage, Identifiable, OffsetPage, Paginated, Repository } from "@brokkr/core";
import { Serde, defineCodec } from "@brokkr/serde-engine";

/**
 * A serde instance that also understands Mongo `ObjectId`, so cursor values
 * (which default to `_id`) round-trip losslessly. This is the integration point
 * with `@brokkr/serde-engine`: teach it one extra type and everything composes.
 */
const cursorSerde = new Serde({
  codecs: [
    defineCodec<Types.ObjectId, string>({
      name: "ObjectId",
      match: (value) => value instanceof Types.ObjectId,
      serialize: (value) => value.toHexString(),
      deserialize: (hex) => new Types.ObjectId(hex),
    }),
  ],
});

export interface VaultOptions<T> {
  /** Field used for stable cursor ordering. Defaults to `_id`. */
  cursorField?: string;
  /** Map a raw lean document into your entity shape. Defaults to `_id` -> `id`. */
  serializer?: (doc: Record<string, unknown>) => T;
}

/** Default projection: expose `_id` as `id`, drop Mongoose's `__v`. */
function defaultSerializer<T>(doc: Record<string, unknown>): T {
  const { _id, __v, ...rest } = doc;
  return { id: String(_id), ...rest } as T;
}

/** Cursors are opaque, base64url-encoded serde strings — never parse them by hand. */
function encodeCursor(value: unknown): string {
  return Buffer.from(cursorSerde.serialize(value)).toString("base64url");
}
function decodeCursor(cursor: string): unknown {
  return cursorSerde.deserialize(Buffer.from(cursor, "base64url").toString("utf8"));
}

/**
 * Build a repository over a Mongoose model.
 *
 * @example
 * const users = createVault<User>(UserModel);
 * const page = await users.paginate({}, { limit: 20 });
 * const next = await users.paginate({}, { limit: 20, cursor: page.cursor.next });
 */
export function createVault<T extends Identifiable>(
  model: Model<Record<string, unknown>>,
  options: VaultOptions<T> = {},
): Repository<T> {
  const cursorField = options.cursorField ?? "_id";
  const toEntity = options.serializer ?? defaultSerializer<T>;

  return {
    async findById(id) {
      const doc = await model.findById(id).lean().exec();
      return doc ? toEntity(doc as Record<string, unknown>) : null;
    },

    async findOne(filter) {
      const doc = await model
        .findOne(filter as FilterQuery<Record<string, unknown>>)
        .lean()
        .exec();
      return doc ? toEntity(doc as Record<string, unknown>) : null;
    },

    async list(filter = {}, page: OffsetPage = {}) {
      const { limit = 50, offset = 0 } = page;
      const docs = await model
        .find(filter as FilterQuery<Record<string, unknown>>)
        .skip(offset)
        .limit(limit)
        .lean()
        .exec();
      return docs.map((d) => toEntity(d as Record<string, unknown>));
    },

    async paginate(filter = {}, page: CursorPage = {}): Promise<Paginated<T>> {
      const { limit = 50, cursor = null } = page;
      const query: Record<string, unknown> = { ...(filter as Record<string, unknown>) };
      if (cursor) {
        query[cursorField] = { $gt: decodeCursor(cursor) };
      }

      // Fetch one extra row to detect whether another page exists.
      const docs = await model
        .find(query as FilterQuery<Record<string, unknown>>)
        .sort({ [cursorField]: 1 })
        .limit(limit + 1)
        .lean()
        .exec();

      const hasMore = docs.length > limit;
      const slice = hasMore ? docs.slice(0, limit) : docs;
      const items = slice.map((d) => toEntity(d as Record<string, unknown>));
      const last = slice.at(-1) as Record<string, unknown> | undefined;

      return {
        items,
        hasMore,
        cursor: {
          next: hasMore && last ? encodeCursor(last[cursorField]) : null,
          prev: cursor,
        },
      };
    },

    async count(filter = {}) {
      return model.countDocuments(filter as FilterQuery<Record<string, unknown>>).exec();
    },

    async create(input) {
      const created = await model.create(input);
      return toEntity(created.toObject() as Record<string, unknown>);
    },

    async update(id, patch) {
      const doc = await model
        .findByIdAndUpdate(id, patch as Record<string, unknown>, { new: true })
        .lean()
        .exec();
      return doc ? toEntity(doc as Record<string, unknown>) : null;
    },

    async delete(id) {
      const res = await model.findByIdAndDelete(id).lean().exec();
      return res != null;
    },
  };
}
