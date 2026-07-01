/**
 * The database-agnostic contract surface. Everything here describes *what* a
 * caller wants — filter, sort, projection, pagination — with zero Mongo syntax
 * leaking through. `MongoVault` translates these into Mongoose internally.
 */

/** Anything addressable by a stable identifier. `ID` defaults to a hex string. */
export interface Identifiable<ID = string> {
  id: ID;
}

/** Shape accepted by `create` — the entity without `id`, with an optional `id` override. */
export type CreateInput<T extends Identifiable<ID>, ID = string> = Omit<T, "id"> & { id?: ID };

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Comparison operators for a field of type `V`. String-only operators resolve to
 * `never` on non-string fields, so the compiler rejects them where meaningless.
 */
export interface FilterOperators<V> {
  eq?: V;
  ne?: V;
  in?: readonly V[];
  nin?: readonly V[];
  gt?: V;
  gte?: V;
  lt?: V;
  lte?: V;
  exists?: boolean;
  /** Case-insensitive substring match. String fields only. */
  contains?: V extends string ? string : never;
  /** Regular-expression source. String fields only. */
  regex?: V extends string ? string : never;
}

/** A field constraint: a bare value (shorthand for `eq`) or a set of operators. */
export type Condition<V> = V | FilterOperators<V>;

/**
 * A fully-typed query over `T`. Callers express intent (`{ age: { gte: 18 } }`),
 * never engine syntax — no `$gt`, and deliberately no `Record<string, unknown>`
 * escape hatch. Compose with `and` / `or`.
 */
export type Where<T> = {
  [K in keyof T]?: Condition<T[K]>;
} & {
  and?: Where<T>[];
  or?: Where<T>[];
};

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortDirection = "asc" | "desc";

export interface SortField<T> {
  field: keyof T & string;
  direction: SortDirection;
}

/** Ordered sort keys — order matters for stable keyset (cursor) pagination. */
export type Sort<T> = ReadonlyArray<SortField<T>>;

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * The set of entity fields to return. Empty/undefined = the whole entity. Feed a
 * GraphQL resolver's requested field names here to project only what's asked for.
 */
export type Projection<T> = ReadonlyArray<keyof T & string>;

// ---------------------------------------------------------------------------
// Relay-style connections
// ---------------------------------------------------------------------------

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface Edge<T> {
  node: T;
  cursor: string;
}

export interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
  totalCount?: number;
}

/**
 * Relay pagination args. Forward paging uses `first`/`after`; backward paging
 * uses `last`/`before`. Cursors are opaque base64url strings.
 */
export interface ConnectionArgs {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

// ---------------------------------------------------------------------------
// Operation options
// ---------------------------------------------------------------------------

export interface FindOptions<T> {
  where?: Where<T>;
  sort?: Sort<T>;
  projection?: Projection<T>;
  limit?: number;
}

export interface PaginateOptions<T> {
  where?: Where<T>;
  sort?: Sort<T>;
  projection?: Projection<T>;
  /** Include a `totalCount` (an extra `countDocuments` query). Off by default. */
  totalCount?: boolean;
}
