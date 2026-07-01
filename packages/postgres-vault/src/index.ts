/**
 * @brokkr/postgres-vault
 *
 * A Drizzle-backed {@link Repository} for Postgres — the SQL sibling of
 * `@brokkr/mongo-vault`. Same shape (read + write, `find`/`list`, stable cursor
 * pagination, pluggable serializer), different engine. `drizzle-orm` is a peer
 * dependency: bring your own `db` instance and table schema.
 */

import { and, asc, eq, getTableColumns, gt, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgDatabase, PgTable } from "drizzle-orm/pg-core";
import {
  BrokkrError,
  type CursorPage,
  type Identifiable,
  type OffsetPage,
  type Paginated,
  type Repository,
} from "@brokkr/core";
import { deserialize, serialize } from "@brokkr/serde-engine";

/** A Drizzle Postgres database handle (driver-agnostic — node-postgres, pg, neon, …). */
type Db = PgDatabase<any, any, any>;

export interface DrizzleVaultOptions<T> {
  /** Primary-key column, used by `findById`/`update`/`delete`. Defaults to `table.id`. */
  idColumn?: PgColumn;
  /** Column used for stable cursor ordering. Defaults to the id column. */
  cursorColumn?: PgColumn;
  /** Map a raw Drizzle row into your entity shape. Defaults to identity. */
  serializer?: (row: Record<string, unknown>) => T;
}

function requireColumn(columns: Record<string, PgColumn>, name: string): PgColumn {
  const col = columns[name];
  if (!col) {
    throw new BrokkrError(
      `postgres-vault: table has no "${name}" column — pass options.idColumn explicitly`,
    );
  }
  return col;
}

/** Build an AND-ed equality predicate from a partial filter, skipping unknown keys. */
function buildWhere(
  columns: Record<string, PgColumn>,
  filter: Record<string, unknown>,
): SQL | undefined {
  const conditions: SQL[] = [];
  for (const [key, value] of Object.entries(filter)) {
    const col = columns[key];
    if (col) conditions.push(eq(col, value as never));
  }
  return conditions.length ? and(...conditions) : undefined;
}

/** Cursors are opaque, base64url-encoded serde strings — never parse them by hand. */
function encodeCursor(value: unknown): string {
  return Buffer.from(serialize(value)).toString("base64url");
}
function decodeCursor(cursor: string): unknown {
  return deserialize(Buffer.from(cursor, "base64url").toString("utf8"));
}

/**
 * Build a repository over a Drizzle table.
 *
 * @example
 * const users = createVault<User>(db, usersTable);
 * const page = await users.paginate({}, { limit: 20 });
 * const next = await users.paginate({}, { limit: 20, cursor: page.cursor.next });
 */
export function createVault<T extends Identifiable>(
  db: Db,
  table: PgTable,
  options: DrizzleVaultOptions<T> = {},
): Repository<T> {
  const columns = getTableColumns(table) as unknown as Record<string, PgColumn>;
  const idColumn = options.idColumn ?? requireColumn(columns, "id");
  const cursorColumn = options.cursorColumn ?? idColumn;
  const toEntity = options.serializer ?? ((row: Record<string, unknown>) => row as T);

  const rowsOf = (result: unknown): Record<string, unknown>[] =>
    result as Record<string, unknown>[];

  return {
    async findById(id) {
      const rows = rowsOf(
        await db
          .select()
          .from(table)
          .where(eq(idColumn, id as never))
          .limit(1),
      );
      const row = rows[0];
      return row ? toEntity(row) : null;
    },

    async findOne(filter) {
      const where = buildWhere(columns, filter as Record<string, unknown>);
      const rows = rowsOf(await db.select().from(table).where(where).limit(1));
      const row = rows[0];
      return row ? toEntity(row) : null;
    },

    async list(filter = {}, page: OffsetPage = {}) {
      const { limit = 50, offset = 0 } = page;
      const where = buildWhere(columns, filter as Record<string, unknown>);
      const rows = rowsOf(await db.select().from(table).where(where).limit(limit).offset(offset));
      return rows.map(toEntity);
    },

    async paginate(filter = {}, page: CursorPage = {}): Promise<Paginated<T>> {
      const { limit = 50, cursor = null } = page;
      const base = buildWhere(columns, filter as Record<string, unknown>);
      const keyset = cursor ? gt(cursorColumn, decodeCursor(cursor) as never) : undefined;
      const where = and(base, keyset);

      // Fetch one extra row to detect whether another page exists.
      const rows = rowsOf(
        await db
          .select()
          .from(table)
          .where(where)
          .orderBy(asc(cursorColumn))
          .limit(limit + 1),
      );

      const hasMore = rows.length > limit;
      const slice = hasMore ? rows.slice(0, limit) : rows;
      const items = slice.map(toEntity);
      const last = slice.at(-1);
      const cursorKey = cursorColumn.name;

      return {
        items,
        hasMore,
        cursor: {
          next: hasMore && last ? encodeCursor(last[cursorKey]) : null,
          prev: cursor,
        },
      };
    },

    async count(filter = {}) {
      const where = buildWhere(columns, filter as Record<string, unknown>);
      const rows = rowsOf(
        await db
          .select({ count: sql<number>`count(*)::int` })
          .from(table)
          .where(where),
      );
      const row = rows[0] as { count?: number } | undefined;
      return row?.count ?? 0;
    },

    async create(input) {
      const rows = rowsOf(
        await db
          .insert(table)
          .values(input as Record<string, unknown>)
          .returning(),
      );
      const row = rows[0];
      if (!row) throw new BrokkrError("postgres-vault: insert returned no rows");
      return toEntity(row);
    },

    async update(id, patch) {
      const rows = rowsOf(
        await db
          .update(table)
          .set(patch as Record<string, unknown>)
          .where(eq(idColumn, id as never))
          .returning(),
      );
      const row = rows[0];
      return row ? toEntity(row) : null;
    },

    async delete(id) {
      const rows = rowsOf(
        await db
          .delete(table)
          .where(eq(idColumn, id as never))
          .returning(),
      );
      return rows.length > 0;
    },
  };
}
