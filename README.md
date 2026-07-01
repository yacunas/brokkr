# Brokkr

> Named for the dwarven smith of Norse myth who forged the gods' tools — a set of small, reusable TypeScript libraries forged once and reused across apps.

A pnpm + Turborepo monorepo. Each library is published independently under the `@brokkr/*` scope, so consumers install only what they use. Every package ships **ESM + CJS + type declarations** and works in **plain TypeScript or NestJS** (decorators/metadata are enabled).

## Packages

| Package                                             | What it does                                                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`@brokkr/core`](packages/core)                     | Shared interfaces, contracts, and errors that the data libraries implement. Zero runtime deps.                                         |
| [`@brokkr/serde-engine`](packages/serde-engine)     | Structured, extensible, versioned (de)serialization — round-trips `Date`/`Map`/`Set`/`BigInt`/…, custom codecs, injectable. Zero deps. |
| [`@brokkr/mongo-vault`](packages/mongo-vault)       | Mongoose-backed repository: read + write, find/list, cursor pagination, pluggable serializer.                                          |
| [`@brokkr/postgres-vault`](packages/postgres-vault) | Drizzle-backed Postgres repository — same shape as `mongo-vault`, different engine.                                                    |

## Develop

```bash
pnpm install         # install all workspace deps
pnpm build           # build every package (Turborepo, respects dep graph)
pnpm dev             # watch-build all packages
pnpm typecheck       # type-check the whole workspace
```

## Add a new package

1. `mkdir -p packages/<name>/src`
2. Copy an existing package's `package.json`, `tsconfig.json`, `tsup.config.ts`.
3. Name it `@brokkr/<name>`, write `src/index.ts`, run `pnpm build`.

## Release

Versioning and publishing are managed with [Changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset            # describe your change, pick affected packages + bump type
pnpm version-packages     # apply version bumps + changelogs
pnpm release              # build + publish changed packages to npm
```

All packages are `publishConfig.access: public`, so publishing scoped packages is free.

## License

MIT © Yronnel James
