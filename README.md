# Brokkr

> Named for the dwarven smith of Norse myth who forged the gods' tools — a set of small, reusable TypeScript libraries forged once and reused across apps.

A pnpm + Turborepo monorepo. Each library is published independently under the `@brokkr/*` scope, so consumers install only what they use. Every package ships **ESM + CJS + type declarations** and works in **plain TypeScript or NestJS** (decorators/metadata are enabled).

## Packages

**Data & serialization**

| Package                                         | What it does                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@brokkr/serde-engine`](packages/serde-engine) | Structured, extensible, versioned (de)serialization — round-trips `Date`/`Map`/`Set`/`BigInt`/…, custom codecs, injectable. Zero deps.        |
| [`@brokkr/mongo-vault`](packages/mongo-vault)   | Fully-typed, GraphQL-ready Mongoose data layer — typed filter/sort/projection, keyset cursor pagination, pluggable id adapters, typed errors. |
| [`@brokkr/rune`](packages/rune)                 | GraphQL toolkit — Relay connections, common scalars, and resolve-info → projection that feeds `mongo-vault`.                                  |
| [`@brokkr/dataloader`](packages/dataloader)     | Batching + per-request caching to eliminate N+1.                                                                                              |

**Backend building blocks** (all zero-dependency)

| Package                                 | What it does                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`@brokkr/result`](packages/result)     | Typed `Result`/`Either` — errors as values, no exceptions.                                               |
| [`@brokkr/throttle`](packages/throttle) | Concurrency limiting (bounded pool, `mapLimit`) + rate limiting (token-bucket / sliding / fixed window). |
| [`@brokkr/retry`](packages/retry)       | Resilience — retry with backoff + jitter, timeout, circuit breaker.                                      |
| [`@brokkr/cache`](packages/cache)       | Cache abstraction — TTL + LRU, single-flight `wrap`, stale-while-revalidate, pluggable store.            |
| [`@brokkr/config`](packages/config)     | Typed env/config loader — coercion, validation, defaults, one aggregated error.                          |
| [`@brokkr/logger`](packages/logger)     | Structured logging — levels, child/context loggers, redaction, pluggable sink.                           |
| [`@brokkr/events`](packages/events)     | Strongly-typed event emitter — sync/async emit, error isolation.                                         |
| [`@brokkr/guard`](packages/guard)       | Authorization — RBAC + lightweight ABAC, deny precedence, typed checks.                                  |

> `@brokkr/core` and `@brokkr/postgres-vault` remain in the tree but are not the
> focus; the active data path is `mongo-vault` + `rune`.

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
