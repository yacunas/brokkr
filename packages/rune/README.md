# @brokkr/rune

A small, focused GraphQL toolkit for the brokkr suite. It has one peer
dependency — `graphql` (`>=16`) — and pairs with
[`@brokkr/mongo-vault`](../mongo-vault) to turn GraphQL queries into efficient,
projected database reads.

Three areas:

## 1. Scalars

Ready-to-use custom `GraphQLScalarType` instances:

- **`DateTimeScalar`** — JS `Date` ⇄ ISO-8601 UTC string. `serialize` accepts a
  `Date` or ISO string and emits an ISO string; `parseValue` / `parseLiteral`
  yield a `Date`. Invalid input throws a `GraphQLError`.
- **`JSONScalar`** — an arbitrary JSON value, passed through untouched.
  `parseLiteral` reconstructs object/list/int/float/string/boolean/null literals
  recursively.
- **`BigIntScalar`** — JS `bigint` ⇄ decimal string, for integers beyond
  `Number.MAX_SAFE_INTEGER`. Accepts string or int literals; throws on
  non-integers.

```ts
import { DateTimeScalar, JSONScalar, BigIntScalar } from "@brokkr/rune";
// register these in your schema's scalar map
```

## 2. Relay connections

Helpers implementing the
[Relay Cursor Connections](https://relay.dev/graphql/connections.htm) slicing
algorithm over an in-memory array:

- `offsetToCursor(offset)` / `cursorToOffset(cursor)` — opaque, base64
  offset cursors (`cursorToOffset` returns `-1` when unparseable).
- `connectionFromArray(data, args)` — applies forward (`first`/`after`) and
  backward (`last`/`before`) pagination, producing `edges` with cursors, an
  accurate `pageInfo` (`hasNextPage` / `hasPreviousPage` / `startCursor` /
  `endCursor`), and `totalCount`.

Exported types: `PageInfo`, `Edge<T>`, `Connection<T>`, `ConnectionArguments`.

```ts
import { connectionFromArray } from "@brokkr/rune";

const conn = connectionFromArray(allUsers, { first: 20, after: cursor });
```

## 3. Resolve-info projection

`getRequestedFields(info, options?)` walks a resolver's `GraphQLResolveInfo` and
returns the distinct field names the client actually selected. It resolves
`FragmentSpread` (via `info.fragments`) and `InlineFragment`, skips
`__typename`, and returns only the field names at the requested level (it does
not recurse into their sub-selections).

The optional `path` descends through nested selection sets first — pass
`"edges.node"` to project the node fields of a Relay connection query.

### Pairing with mongo-vault

This is the payoff: `@brokkr/mongo-vault` accepts a projection (the set of
fields to fetch). Feed it the fields the client asked for so the database only
returns those columns.

```ts
import { getRequestedFields } from "@brokkr/rune";

const usersResolver = (_parent, args, _ctx, info) => {
  // Only fetch the node fields the client selected under edges.node
  const projection = getRequestedFields(info, { path: "edges.node" });
  return users.paginate(args, { projection });
};
```

## License

MIT © Yronnel James
