/**
 * Relay Cursor Connections helpers.
 *
 * Implements the in-memory slicing algorithm from the
 * {@link https://relay.dev/graphql/connections.htm | Relay Connections spec}:
 * given a full array and the standard `first`/`after`/`last`/`before`
 * arguments, produce a {@link Connection} with offset-based cursors and a
 * correct {@link PageInfo}.
 */

/** Standard Relay pagination metadata. */
export interface PageInfo {
  /** Whether more edges exist after `endCursor` (forward pagination). */
  hasNextPage: boolean;
  /** Whether more edges exist before `startCursor` (backward pagination). */
  hasPreviousPage: boolean;
  /** Cursor of the first edge in this page, or `null` when empty. */
  startCursor: string | null;
  /** Cursor of the last edge in this page, or `null` when empty. */
  endCursor: string | null;
}

/** A single connection edge: a node plus its opaque cursor. */
export interface Edge<T> {
  node: T;
  cursor: string;
}

/** A Relay connection: a page of edges plus page metadata. */
export interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
  /** Total number of items in the underlying data set. */
  totalCount?: number;
}

/** The four standard Relay connection arguments. */
export interface ConnectionArguments {
  /** Forward pagination: take the first N edges after `after`. */
  first?: number;
  /** Forward pagination: cursor to start after. */
  after?: string;
  /** Backward pagination: take the last N edges before `before`. */
  last?: number;
  /** Backward pagination: cursor to end before. */
  before?: string;
}

const CURSOR_PREFIX = "offset:";

/** Base64-encode an array offset into an opaque cursor. */
export function offsetToCursor(offset: number): string {
  return Buffer.from(`${CURSOR_PREFIX}${offset}`, "utf8").toString("base64");
}

/**
 * Decode an offset cursor produced by {@link offsetToCursor}. Returns `-1`
 * when the cursor is missing, malformed, or not an offset cursor.
 */
export function cursorToOffset(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    if (!decoded.startsWith(CURSOR_PREFIX)) {
      return -1;
    }
    const offset = parseInt(decoded.slice(CURSOR_PREFIX.length), 10);
    return Number.isNaN(offset) ? -1 : offset;
  } catch {
    return -1;
  }
}

/** Clamp a value into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Build a {@link Connection} from a fully-materialized array, applying the
 * Relay in-memory slicing algorithm.
 *
 * Forward pagination (`first`/`after`) and backward pagination
 * (`last`/`before`) are supported and may be combined per the spec. Cursors
 * are offset-based (see {@link offsetToCursor}), and `totalCount` reflects the
 * length of the input array.
 *
 * @typeParam T - The node type.
 * @param data - The full, ordered array of nodes.
 * @param args - The Relay connection arguments.
 */
export function connectionFromArray<T>(
  data: readonly T[],
  args: ConnectionArguments,
): Connection<T> {
  const { first, after, last, before } = args;
  const size = data.length;

  // Cursors are offsets to the item they point AT. The slice bounds
  // [sliceStart, sliceEnd) are the half-open window of remaining items.
  const afterOffset = after !== undefined ? cursorToOffset(after) : -1;
  const beforeOffset = before !== undefined ? cursorToOffset(before) : size;

  // Start just after the `after` cursor; end just before the `before` cursor.
  let sliceStart = afterOffset >= 0 ? clamp(afterOffset + 1, 0, size) : 0;
  let sliceEnd = beforeOffset >= 0 ? clamp(beforeOffset, 0, size) : size;
  if (sliceEnd < sliceStart) {
    sliceEnd = sliceStart;
  }

  // Record the window before `first`/`last` narrowing so we can compute the
  // hasNextPage / hasPreviousPage flags accurately.
  const afterSliceStart = sliceStart;
  const beforeSliceEnd = sliceEnd;

  if (first !== undefined) {
    if (first < 0) {
      throw new RangeError("`first` must be a non-negative integer");
    }
    sliceEnd = Math.min(sliceEnd, sliceStart + first);
  }
  if (last !== undefined) {
    if (last < 0) {
      throw new RangeError("`last` must be a non-negative integer");
    }
    sliceStart = Math.max(sliceStart, sliceEnd - last);
  }

  const edges: Edge<T>[] = [];
  for (let index = sliceStart; index < sliceEnd; index++) {
    edges.push({ node: data[index] as T, cursor: offsetToCursor(index) });
  }

  const firstEdge = edges[0];
  const lastEdge = edges[edges.length - 1];

  return {
    edges,
    totalCount: size,
    pageInfo: {
      startCursor: firstEdge ? firstEdge.cursor : null,
      endCursor: lastEdge ? lastEdge.cursor : null,
      // Per spec: if `last`/`first` narrowed the window, more items remain.
      hasPreviousPage: last !== undefined ? sliceStart > afterSliceStart : afterOffset >= 0,
      hasNextPage: first !== undefined ? sliceEnd < beforeSliceEnd : beforeOffset < size,
    },
  };
}
