/**
 * @brokkr/core
 *
 * Shared contracts every Brokkr data library implements. Application code depends
 * on these interfaces, not on a concrete driver — so `@brokkr/mongo-vault` (and any
 * future Postgres layer) are swappable behind the same shape.
 */

/** Anything the repositories can address by a stable identifier. */
export interface Identifiable<ID = string> {
  id: ID;
}

/** Classic offset/limit paging — simple, but drifts under concurrent writes. */
export interface OffsetPage {
  limit?: number;
  offset?: number;
}

/** Cursor (keyset) paging — stable under inserts, the preferred default. */
export interface CursorPage {
  limit?: number;
  cursor?: string | null;
}

/** A page of results plus the cursors needed to walk forward/back. */
export interface Paginated<T> {
  items: T[];
  hasMore: boolean;
  cursor: {
    next: string | null;
    prev: string | null;
  };
}

/** Read side of a data store. */
export interface ReadRepository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  findOne(filter: Partial<T>): Promise<T | null>;
  list(filter?: Partial<T>, page?: OffsetPage): Promise<T[]>;
  paginate(filter?: Partial<T>, page?: CursorPage): Promise<Paginated<T>>;
  count(filter?: Partial<T>): Promise<number>;
}

/** Write side of a data store. */
export interface WriteRepository<T, ID = string> {
  create(input: Omit<T, "id">): Promise<T>;
  update(id: ID, patch: Partial<T>): Promise<T | null>;
  delete(id: ID): Promise<boolean>;
}

/** Full read + write repository. */
export interface Repository<T extends Identifiable<ID>, ID = string>
  extends ReadRepository<T, ID>,
    WriteRepository<T, ID> {}

/** Something that can report whether its backing connection is alive. */
export interface HealthCheck {
  ping(): Promise<boolean>;
}

/** Something holding a resource that must be released. */
export interface Disposable {
  close(): Promise<void>;
}

/** Base error for every Brokkr package — carries an optional underlying cause. */
export class BrokkrError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BrokkrError";
  }
}

/** Thrown (or used) when an entity cannot be located by id. */
export class NotFoundError extends BrokkrError {
  constructor(entity: string, id: unknown) {
    super(`${entity} "${String(id)}" was not found`);
    this.name = "NotFoundError";
  }
}
