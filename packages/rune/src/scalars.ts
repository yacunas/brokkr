/**
 * Common custom GraphQL scalars.
 *
 * Each export is a ready-to-use {@link GraphQLScalarType} instance:
 *
 * - {@link DateTimeScalar} — JS `Date` ⇄ ISO-8601 string.
 * - {@link JSONScalar} — passthrough of any JSON value.
 * - {@link BigIntScalar} — JS `bigint` ⇄ decimal string.
 *
 * All scalars throw {@link GraphQLError} (never a bare `Error`) on invalid
 * input so that GraphQL surfaces a well-formed error to the client.
 */

import {
  GraphQLError,
  GraphQLScalarType,
  Kind,
  type ObjectValueNode,
  type ValueNode,
} from "graphql";

/**
 * Coerce a value to a `Date`, or throw a {@link GraphQLError} if it cannot
 * represent a valid instant.
 */
function coerceDate(value: unknown): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new GraphQLError("DateTime cannot represent an invalid Date instance");
    }
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new GraphQLError(`DateTime cannot parse non-ISO-8601 string: ${JSON.stringify(value)}`);
    }
    return parsed;
  }
  throw new GraphQLError(
    `DateTime cannot represent value of type ${typeof value}: ${JSON.stringify(value)}`,
  );
}

/**
 * `DateTime` — represents an instant in time as an ISO-8601 UTC string on the
 * wire, and a JS {@link Date} in resolvers.
 *
 * - `serialize` accepts a `Date` or ISO string and emits an ISO string.
 * - `parseValue` / `parseLiteral` accept an ISO string and yield a `Date`.
 */
export const DateTimeScalar = new GraphQLScalarType<Date, string>({
  name: "DateTime",
  description: "An ISO-8601 encoded UTC date-time string.",
  serialize(value: unknown): string {
    return coerceDate(value).toISOString();
  },
  parseValue(value: unknown): Date {
    if (typeof value !== "string") {
      throw new GraphQLError("DateTime must be provided as an ISO-8601 string");
    }
    return coerceDate(value);
  },
  parseLiteral(ast: ValueNode): Date {
    if (ast.kind !== Kind.STRING) {
      throw new GraphQLError("DateTime must be provided as a string literal", { nodes: ast });
    }
    return coerceDate(ast.value);
  },
});

/** Any value that survives a JSON round-trip. */
export type JSONValue =
  null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };

/**
 * Recursively convert a GraphQL literal AST node into a plain JSON value.
 * Variables inside object/list literals cannot be resolved without variable
 * values, so they are treated as `undefined` (omitted).
 */
function parseJSONLiteral(ast: ValueNode): JSONValue {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
      return parseInt(ast.value, 10);
    case Kind.FLOAT:
      return parseFloat(ast.value);
    case Kind.NULL:
      return null;
    case Kind.ENUM:
      return ast.value;
    case Kind.LIST:
      return ast.values.map((node) => parseJSONLiteral(node));
    case Kind.OBJECT:
      return parseJSONObject(ast);
    default:
      throw new GraphQLError(`JSON cannot represent literal of kind ${ast.kind}`, { nodes: ast });
  }
}

function parseJSONObject(ast: ObjectValueNode): { [key: string]: JSONValue } {
  const value: { [key: string]: JSONValue } = {};
  for (const field of ast.fields) {
    value[field.name.value] = parseJSONLiteral(field.value);
  }
  return value;
}

/**
 * `JSON` — an arbitrary JSON value passed through untouched. Use sparingly:
 * `JSON` opts out of GraphQL's type system.
 */
export const JSONScalar = new GraphQLScalarType<JSONValue, JSONValue>({
  name: "JSON",
  description: "An arbitrary JSON value.",
  serialize(value: unknown): JSONValue {
    return value as JSONValue;
  },
  parseValue(value: unknown): JSONValue {
    return value as JSONValue;
  },
  parseLiteral(ast: ValueNode): JSONValue {
    return parseJSONLiteral(ast);
  },
});

/**
 * Coerce a value to a `bigint`, or throw a {@link GraphQLError}. Accepts a
 * decimal string, a safe integer `number`, or a `bigint`.
 */
function coerceBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      throw new GraphQLError(`BigInt cannot parse non-integer string: ${JSON.stringify(value)}`);
    }
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new GraphQLError(`BigInt cannot represent non-integer number: ${value}`);
    }
    return BigInt(value);
  }
  throw new GraphQLError(
    `BigInt cannot represent value of type ${typeof value}: ${JSON.stringify(value)}`,
  );
}

/**
 * `BigInt` — an arbitrary-precision integer, encoded as a decimal string on
 * the wire and a JS {@link BigInt} in resolvers.
 */
export const BigIntScalar = new GraphQLScalarType<bigint, string>({
  name: "BigInt",
  description: "An arbitrary-precision integer encoded as a decimal string.",
  serialize(value: unknown): string {
    return coerceBigInt(value).toString();
  },
  parseValue(value: unknown): bigint {
    return coerceBigInt(value);
  },
  parseLiteral(ast: ValueNode): bigint {
    if (ast.kind === Kind.INT) {
      return coerceBigInt(ast.value);
    }
    if (ast.kind === Kind.STRING) {
      return coerceBigInt(ast.value);
    }
    throw new GraphQLError("BigInt must be provided as an integer or string literal", {
      nodes: ast,
    });
  },
});
