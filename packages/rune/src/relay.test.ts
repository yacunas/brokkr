import { describe, expect, it } from "vitest";
import { connectionFromArray, cursorToOffset, offsetToCursor } from "./relay";

const letters = ["a", "b", "c", "d", "e"] as const;

describe("cursor helpers", () => {
  it("round-trips offset -> cursor -> offset", () => {
    for (const offset of [0, 1, 42, 1000]) {
      expect(cursorToOffset(offsetToCursor(offset))).toBe(offset);
    }
  });

  it("returns -1 for an unparseable cursor", () => {
    expect(cursorToOffset("not-a-cursor")).toBe(-1);
    expect(cursorToOffset(Buffer.from("other:3", "utf8").toString("base64"))).toBe(-1);
  });
});

describe("connectionFromArray", () => {
  it("returns all edges with correct cursors and totalCount when unpaginated", () => {
    const conn = connectionFromArray(letters, {});
    expect(conn.edges.map((e) => e.node)).toEqual(["a", "b", "c", "d", "e"]);
    expect(conn.totalCount).toBe(5);
    expect(conn.edges[0]!.cursor).toBe(offsetToCursor(0));
    expect(conn.edges[4]!.cursor).toBe(offsetToCursor(4));
    expect(conn.pageInfo.hasNextPage).toBe(false);
    expect(conn.pageInfo.hasPreviousPage).toBe(false);
  });

  it("forward slices with first", () => {
    const conn = connectionFromArray(letters, { first: 2 });
    expect(conn.edges.map((e) => e.node)).toEqual(["a", "b"]);
    expect(conn.pageInfo.hasNextPage).toBe(true);
    expect(conn.pageInfo.hasPreviousPage).toBe(false);
    expect(conn.pageInfo.startCursor).toBe(offsetToCursor(0));
    expect(conn.pageInfo.endCursor).toBe(offsetToCursor(1));
  });

  it("forward slices with first + after", () => {
    const conn = connectionFromArray(letters, { first: 2, after: offsetToCursor(1) });
    expect(conn.edges.map((e) => e.node)).toEqual(["c", "d"]);
    expect(conn.pageInfo.hasNextPage).toBe(true);
    expect(conn.pageInfo.startCursor).toBe(offsetToCursor(2));
    expect(conn.pageInfo.endCursor).toBe(offsetToCursor(3));
  });

  it("reports hasNextPage false at the forward boundary", () => {
    const conn = connectionFromArray(letters, { first: 3, after: offsetToCursor(1) });
    expect(conn.edges.map((e) => e.node)).toEqual(["c", "d", "e"]);
    expect(conn.pageInfo.hasNextPage).toBe(false);
  });

  it("backward slices with last", () => {
    const conn = connectionFromArray(letters, { last: 2 });
    expect(conn.edges.map((e) => e.node)).toEqual(["d", "e"]);
    expect(conn.pageInfo.hasPreviousPage).toBe(true);
    expect(conn.pageInfo.hasNextPage).toBe(false);
    expect(conn.pageInfo.startCursor).toBe(offsetToCursor(3));
    expect(conn.pageInfo.endCursor).toBe(offsetToCursor(4));
  });

  it("backward slices with last + before", () => {
    const conn = connectionFromArray(letters, { last: 2, before: offsetToCursor(3) });
    expect(conn.edges.map((e) => e.node)).toEqual(["b", "c"]);
    expect(conn.pageInfo.hasPreviousPage).toBe(true);
    expect(conn.pageInfo.startCursor).toBe(offsetToCursor(1));
    expect(conn.pageInfo.endCursor).toBe(offsetToCursor(2));
  });

  it("reports hasPreviousPage false at the backward boundary", () => {
    const conn = connectionFromArray(letters, { last: 3, before: offsetToCursor(3) });
    expect(conn.edges.map((e) => e.node)).toEqual(["a", "b", "c"]);
    expect(conn.pageInfo.hasPreviousPage).toBe(false);
  });

  it("handles an empty array", () => {
    const conn = connectionFromArray([], { first: 5 });
    expect(conn.edges).toEqual([]);
    expect(conn.totalCount).toBe(0);
    expect(conn.pageInfo).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
  });

  it("cursors decode back to their offsets", () => {
    const conn = connectionFromArray(letters, { first: 3, after: offsetToCursor(1) });
    expect(conn.edges.map((e) => cursorToOffset(e.cursor))).toEqual([2, 3, 4]);
  });

  it("throws on a negative first", () => {
    expect(() => connectionFromArray(letters, { first: -1 })).toThrow(RangeError);
  });
});
