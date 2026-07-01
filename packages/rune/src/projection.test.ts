import { describe, expect, it } from "vitest";
import {
  GraphQLBoolean,
  GraphQLInt,
  GraphQLList,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLSchema,
  GraphQLString,
  graphql,
} from "graphql";
import { getRequestedFields } from "./projection";

/**
 * Run `query` against a tiny schema whose `user` (and connection) resolvers
 * capture the `GraphQLResolveInfo`, then hand it to `collect` for assertions.
 */
async function captureInfo(
  query: string,
  collect: (info: GraphQLResolveInfo) => unknown,
): Promise<void> {
  const User: GraphQLObjectType = new GraphQLObjectType({
    name: "User",
    fields: () => ({
      id: { type: GraphQLString },
      name: { type: GraphQLString },
      email: { type: GraphQLString },
      age: { type: GraphQLInt },
    }),
  });

  const UserEdge = new GraphQLObjectType({
    name: "UserEdge",
    fields: () => ({
      cursor: { type: GraphQLString },
      node: { type: User },
    }),
  });

  const PageInfo = new GraphQLObjectType({
    name: "PageInfo",
    fields: () => ({
      hasNextPage: { type: GraphQLBoolean },
      endCursor: { type: GraphQLString },
    }),
  });

  const UserConnection = new GraphQLObjectType({
    name: "UserConnection",
    fields: () => ({
      edges: { type: new GraphQLList(UserEdge) },
      pageInfo: { type: PageInfo },
      totalCount: { type: GraphQLInt },
    }),
  });

  const Query = new GraphQLObjectType({
    name: "Query",
    fields: () => ({
      user: {
        type: User,
        resolve: (_source, _args, _ctx, info) => {
          collect(info);
          return {};
        },
      },
      users: {
        type: UserConnection,
        resolve: (_source, _args, _ctx, info) => {
          collect(info);
          return { edges: [], pageInfo: {}, totalCount: 0 };
        },
      },
    }),
  });

  const schema = new GraphQLSchema({ query: Query });
  const result = await graphql({ schema, source: query });
  expect(result.errors).toBeUndefined();
}

describe("getRequestedFields", () => {
  it("returns the top-level selected fields", async () => {
    await captureInfo(`{ user { id name email } }`, (info) => {
      expect(getRequestedFields(info).sort()).toEqual(["email", "id", "name"]);
    });
  });

  it("does not descend into sub-selections of collected fields", async () => {
    await captureInfo(`{ users { edges { cursor } totalCount } }`, (info) => {
      // Only the fields selected on `users` — not `edges`' own sub-fields.
      expect(getRequestedFields(info).sort()).toEqual(["edges", "totalCount"]);
    });
  });

  it("descends into a dotted path (edges.node) for a connection", async () => {
    await captureInfo(`{ users { edges { node { id name } } totalCount } }`, (info) => {
      expect(getRequestedFields(info, { path: "edges.node" }).sort()).toEqual(["id", "name"]);
    });
  });

  it("returns [] when a path does not exist", async () => {
    await captureInfo(`{ user { id } }`, (info) => {
      expect(getRequestedFields(info, { path: "edges.node" })).toEqual([]);
    });
  });

  it("resolves fragment spreads", async () => {
    await captureInfo(
      `
        { user { ...Fields } }
        fragment Fields on User { id name }
      `,
      (info) => {
        expect(getRequestedFields(info).sort()).toEqual(["id", "name"]);
      },
    );
  });

  it("resolves inline fragments", async () => {
    await captureInfo(`{ user { ... on User { id age } } }`, (info) => {
      expect(getRequestedFields(info).sort()).toEqual(["age", "id"]);
    });
  });

  it("skips __typename", async () => {
    await captureInfo(`{ user { __typename id } }`, (info) => {
      expect(getRequestedFields(info)).toEqual(["id"]);
    });
  });

  it("resolves fragments nested under a dotted path", async () => {
    await captureInfo(
      `
        { users { edges { node { ...NodeFields } } } }
        fragment NodeFields on User { id email }
      `,
      (info) => {
        expect(getRequestedFields(info, { path: "edges.node" }).sort()).toEqual(["email", "id"]);
      },
    );
  });
});
