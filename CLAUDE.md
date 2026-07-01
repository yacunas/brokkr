# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Brokkr is a **pnpm + Turborepo monorepo** of small, independently-published TypeScript
libraries under the `@brokkr/*` scope. Each package ships ESM + CJS + type declarations
and targets **plain TypeScript or NestJS**. Packages are published separately via
Changesets so consumers install only what they use.

## Commands

Run from the repo root (Turborepo fans tasks out across packages and respects the
dependency graph):

```bash
pnpm install         # install all workspace deps
pnpm build           # build every package (tsup) in dependency order
pnpm dev             # watch-build all packages
pnpm typecheck       # tsc --noEmit across all packages
pnpm test            # run every package's tests
pnpm format          # prettier --write .
pnpm format:check    # prettier --check . (CI-style)
```

Scope work to one package with `--filter`:

```bash
pnpm --filter @brokkr/serde-engine build
pnpm --filter @brokkr/serde-engine test
```

Tests use **Vitest**; every package except `core`/`postgres-vault` has a suite.
`@brokkr/mongo-vault` runs integration tests against `mongodb-memory-server` (it
downloads a mongod binary on first run — hence its longer `vitest.config.ts` timeouts).

```bash
cd packages/serde-engine
pnpm test                                   # run once (vitest run)
pnpm test:watch                             # watch mode
pnpm exec vitest run src/serde.test.ts      # a single file
pnpm exec vitest run -t "circular"          # tests matching a name
```

**Important:** `tsup` and `vitest` use esbuild, which does **not** type-check. Type
errors (especially in test files) only surface via `pnpm typecheck` (or the editor).
Always run `pnpm typecheck` before considering a change done.

## Release

Versioning/publishing is Changesets-driven; every package is `publishConfig.access: public`.

```bash
pnpm changeset          # describe a change, pick affected packages + bump type
pnpm version-packages   # apply version bumps + changelogs
pnpm release            # build + changeset publish
```

## Packages and how they fit together

- **`@brokkr/core`** — shared contracts, zero deps. Defines `Repository<T>`
  (read + write), `ReadRepository`/`WriteRepository`, pagination types
  (`OffsetPage`, `CursorPage`, `Paginated`), and the error base. The vaults implement
  these so application code depends on the interface, not a driver.
- **`@brokkr/serde-engine`** — structured serialization, zero deps (see below).
- **`@brokkr/mongo-vault`** — a `Repository` over a Mongoose model (`createVault`),
  with keyset cursor pagination. Peer dep: `mongoose`.
- **`@brokkr/postgres-vault`** — the same `Repository` shape over a Drizzle table
  (`createVault(db, table)`). Peer dep: `drizzle-orm`. Mirrors `mongo-vault`.

The two vaults are deliberately interchangeable: same `Repository<T>` API, different
engine. Both encode their opaque pagination cursors with serde-engine. `mongo-vault`
registers an `ObjectId` codec on a private `Serde` instance — that is the reference
example of extending serde-engine from another package.

## serde-engine architecture

The core idea: **`JSON.stringify` loses types** (Date→string, Map/Set→`{}`, BigInt
throws). serde-engine walks the value tree and "boxes" anything JSON can't represent
into a tagged marker, then reverses it on read.

Pipeline: `serialize` = `encode` (value → JSON-safe tree) + `JSON.stringify`;
`deserialize` = `JSON.parse` + `decode`. `encode`/`decode` skip the string step
(useful for a Postgres `jsonb` column).

Wire format — a boxed value is `{ "$brokkr": "<tag>", "v": <payload>, "ver"?: <n> }`.
The sentinel key is `$brokkr`; a plain object that literally contains it is escaped
(tag `"$"`) so decoding is never ambiguous.

Files:

- `engine.ts` — the recursive `enc`/`dec` walker. Owns cycle detection (`WeakSet`),
  the `maxDepth` guard, lazy path tracking for error messages (`$.a.b[0]`), and
  `safeAssign` (treats a literal `__proto__` key as a data property, not a prototype
  reassignment). This is the performance- and correctness-critical file.
- `codec.ts` — the extensibility API: abstract `Codec` base and subclasses
  `ClassCodec`, `ClassScalarCodec`, `VersionedCodec`, plus the `defineCodec()` factory.
- `codecs.ts` — built-in codecs (`Date`, `Map`, `Set`, `RegExp`, `URL`). `bigint`,
  `undefined`, `NaN`, `±Infinity`, `-0` are handled inline in the engine.
- `serde.ts` — the `Serde` class (codec registry + serialize/deserialize/encode/decode/
  clone) and the `provideSerde()` / `SERDE` DI helpers.
- `presets.ts` — opt-in codecs: factories for third-party classes (`decimalCodec`,
  `luxonDateTimeCodec`, etc. — you pass the class in, nothing is bundled) and native
  dependency-free codecs (typed arrays, `ArrayBuffer`, `URLSearchParams`, `Error`).
- `index.ts` — public exports plus a shared default `serde` instance and standalone
  `serialize`/`deserialize`/`encode`/`decode`/`clone` bound to it.

Key conventions when working here:

- A **codec** identifies its values by `ctor` (O(1) constructor lookup, the fast path)
  or a `match(value)` predicate (scanned; for subclass/duck-typed matching). `ctor`-based
  codecs go in `byCtor`; `match`-based go in `matchers`. Do not confuse the codec
  `match` predicate with test files.
- **Override a built-in** by registering a codec with the same `name`.
- **Versioning**: `VersionedCodec` writes a `version` into the payload and runs
  `upgrade(old, fromVersion)` on read, so `read()` only sees the current shape — this is
  the backward-compatibility mechanism. Reserved inline tags (`undefined`, `bigint`,
  `number`, `$`) cannot be used as codec names.
- All errors subclass `SerdeError` and carry a `code` and `path`; they are exported for
  importers to catch.

## Conventions

- **Codegen targets:** each package builds with `tsup` to dual ESM/CJS + `.d.ts`; the
  `exports` map wires `import`/`require` conditions. Keep new packages consistent with an
  existing one (copy its `package.json`, `tsconfig.json`, `tsup.config.ts`).
- **Naming:** DB adapters are named `<db>-vault`; keep the suffix consistent across
  adapters and put searchable tech names in `keywords`.
- **Zero-dependency packages** (`core`, `serde-engine`) must stay dependency-free at
  runtime; libraries used by an adapter (mongoose, drizzle-orm) are **peer dependencies**,
  not dependencies, so consumers control the version.
- Prettier config is shared at the root (`printWidth: 100`, double quotes, trailing
  commas). Run `pnpm format` after edits; CI-style check is `pnpm format:check`.

## Git

- Do **not** add a `Co-Authored-By: Claude` trailer (or any Claude/Anthropic attribution)
  to commit messages or PR descriptions.
