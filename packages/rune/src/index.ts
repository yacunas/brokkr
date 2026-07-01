/**
 * @brokkr/rune
 *
 * A small GraphQL toolkit for the brokkr suite, built to pair with
 * `@brokkr/mongo-vault`:
 *
 * - **Scalars** — {@link DateTimeScalar}, {@link JSONScalar}, {@link BigIntScalar}
 *   are ready-to-use custom {@link https://graphql.org/ | GraphQL} scalar types.
 * - **Relay connections** — {@link connectionFromArray} and the cursor helpers
 *   implement the Relay Cursor Connections slicing algorithm over an array.
 * - **Projection** — {@link getRequestedFields} reads a resolver's
 *   `GraphQLResolveInfo` to produce a `mongo-vault` projection of exactly the
 *   fields the client asked for (including `edges.node` of a connection).
 */

export { DateTimeScalar, JSONScalar, BigIntScalar, type JSONValue } from "./scalars";

export {
  connectionFromArray,
  offsetToCursor,
  cursorToOffset,
  type PageInfo,
  type Edge,
  type Connection,
  type ConnectionArguments,
} from "./relay";

export { getRequestedFields, type GetRequestedFieldsOptions } from "./projection";
