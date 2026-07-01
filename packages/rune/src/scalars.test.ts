import { describe, expect, it } from "vitest";
import { GraphQLError, Kind, parseValue as parseLiteralAst, type StringValueNode } from "graphql";
import { BigIntScalar, DateTimeScalar, JSONScalar } from "./scalars";

describe("DateTimeScalar", () => {
  const iso = "2026-07-01T12:34:56.000Z";

  it("serializes a Date to an ISO string", () => {
    expect(DateTimeScalar.serialize(new Date(iso))).toBe(iso);
  });

  it("serializes an ISO string input to a normalized ISO string", () => {
    expect(DateTimeScalar.serialize(iso)).toBe(iso);
  });

  it("round-trips serialize -> parseValue", () => {
    const serialized = DateTimeScalar.serialize(new Date(iso));
    const parsed = DateTimeScalar.parseValue(serialized);
    expect(parsed).toBeInstanceOf(Date);
    expect((parsed as Date).toISOString()).toBe(iso);
  });

  it("parses a string literal into a Date", () => {
    const ast = parseLiteralAst(`"${iso}"`) as StringValueNode;
    const parsed = DateTimeScalar.parseLiteral(ast, undefined);
    expect((parsed as Date).toISOString()).toBe(iso);
  });

  it("throws GraphQLError on an unparseable string", () => {
    expect(() => DateTimeScalar.parseValue("not-a-date")).toThrow(GraphQLError);
  });

  it("throws GraphQLError when serializing an invalid Date", () => {
    expect(() => DateTimeScalar.serialize(new Date("nope"))).toThrow(GraphQLError);
  });

  it("throws GraphQLError on a non-string literal", () => {
    expect(() => DateTimeScalar.parseLiteral({ kind: Kind.INT, value: "5" }, undefined)).toThrow(
      GraphQLError,
    );
  });
});

describe("JSONScalar", () => {
  it("passes through arbitrary values on serialize/parseValue", () => {
    const value = { a: 1, b: [true, null, "x"], c: { d: 2.5 } };
    expect(JSONScalar.serialize(value)).toEqual(value);
    expect(JSONScalar.parseValue(value)).toEqual(value);
  });

  it("parses a nested object literal recursively", () => {
    const ast = parseLiteralAst(`{ a: 1, b: [true, null, "x"], c: { d: 2.5 } }`);
    const parsed = JSONScalar.parseLiteral(ast, undefined);
    expect(parsed).toEqual({ a: 1, b: [true, null, "x"], c: { d: 2.5 } });
  });

  it("parses scalar literals of each kind", () => {
    expect(JSONScalar.parseLiteral(parseLiteralAst(`42`), undefined)).toBe(42);
    expect(JSONScalar.parseLiteral(parseLiteralAst(`4.2`), undefined)).toBe(4.2);
    expect(JSONScalar.parseLiteral(parseLiteralAst(`"s"`), undefined)).toBe("s");
    expect(JSONScalar.parseLiteral(parseLiteralAst(`true`), undefined)).toBe(true);
    expect(JSONScalar.parseLiteral(parseLiteralAst(`null`), undefined)).toBeNull();
  });
});

describe("BigIntScalar", () => {
  const big = 9007199254740993n; // > Number.MAX_SAFE_INTEGER

  it("serializes a bigint to a decimal string", () => {
    expect(BigIntScalar.serialize(big)).toBe("9007199254740993");
  });

  it("round-trips serialize -> parseValue", () => {
    const serialized = BigIntScalar.serialize(big);
    expect(BigIntScalar.parseValue(serialized)).toBe(big);
  });

  it("parses a safe integer number", () => {
    expect(BigIntScalar.parseValue(42)).toBe(42n);
  });

  it("parses an int literal and a string literal", () => {
    expect(BigIntScalar.parseLiteral(parseLiteralAst(`123`), undefined)).toBe(123n);
    expect(BigIntScalar.parseLiteral(parseLiteralAst(`"456"`), undefined)).toBe(456n);
  });

  it("throws GraphQLError on a non-integer string", () => {
    expect(() => BigIntScalar.parseValue("1.5")).toThrow(GraphQLError);
  });

  it("throws GraphQLError on a non-integer number", () => {
    expect(() => BigIntScalar.parseValue(1.5)).toThrow(GraphQLError);
  });

  it("throws GraphQLError on a boolean literal", () => {
    expect(() => BigIntScalar.parseLiteral(parseLiteralAst(`true`), undefined)).toThrow(
      GraphQLError,
    );
  });
});
