/**
 * @brokkr/mongo-vault
 *
 * A fully-typed, GraphQL-ready data-access layer over Mongoose. Exposes intent
 * (`find` / `paginate` / `create` / …) through the abstract {@link Vault}, never
 * Mongo syntax: a typed filter/sort/projection surface, keyset (cursor) Relay
 * pagination, a pluggable {@link IdAdapter} (hex-string ids by default), and
 * opaque cursors encoded with `@brokkr/serde-engine`.
 *
 * @example
 * import { createMongoVault } from "@brokkr/mongo-vault";
 *
 * interface User { id: string; name: string; createdAt: Date }
 * const users = createMongoVault<User>(UserModel);
 *
 * await users.create({ name: "Ada", createdAt: new Date() });
 * const page = await users.paginate({ first: 20 }, { sort: [{ field: "createdAt", direction: "desc" }] });
 * const next = await users.paginate({ first: 20, after: page.pageInfo.endCursor! });
 */

export { Vault, MongoVault, createMongoVault, type MongoVaultOptions } from "./vault";
export {
  type IdAdapter,
  stringObjectIdAdapter,
  objectIdAdapter,
  uuidAdapter,
} from "./id-adapter";
export {
  MongoVaultError,
  DuplicateKeyError,
  WriteConflictError,
  ValidationError,
  InvalidCursorError,
} from "./errors";
export type { PipelineStage } from "mongoose";
export type {
  Identifiable,
  CreateInput,
  FilterOperators,
  Condition,
  Where,
  SortDirection,
  SortField,
  Sort,
  Projection,
  PageInfo,
  Edge,
  Connection,
  ConnectionArgs,
  FindOptions,
  PaginateOptions,
} from "./types";
