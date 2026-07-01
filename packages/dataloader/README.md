# @brokkr/dataloader

Batching and caching data loader for TypeScript. Coalesces every `load(key)`
made in the same tick into a **single** call to your batch function —
eliminating N+1 access patterns — and dedupes repeated keys through a per-key
promise cache. The classic DataLoader pattern, cleanly typed, with zero runtime
dependencies.

## Install

```sh
pnpm add @brokkr/dataloader
```

## Usage

```ts
import { DataLoader } from "@brokkr/dataloader";

const users = new DataLoader<string, User>(async (ids) => {
  const rows = await db.users.findMany({ id: { in: ids } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Return one entry per key, in order. Use an Error to fail a single key.
  return ids.map((id) => byId.get(id) ?? new Error(`No user ${id}`));
});

// Both loads dispatch in ONE batchFn call.
const [a, b] = await Promise.all([users.load("1"), users.load("2")]);
```

## The batch function

```ts
type BatchLoadFn<K, V> = (keys: readonly K[]) => Promise<ReadonlyArray<V | Error>>;
```

The result **must align by index** with the keys and have the same length. An
element that is an `Error` rejects only that key's promise; its siblings still
resolve. A wrong-length result rejects the affected loads with a clear error.

## API

### `new DataLoader(batchFn, options?)`

| Option         | Default          | Description                                                          |
| -------------- | ---------------- | -------------------------------------------------------------------- |
| `maxBatchSize` | `Infinity`       | Split the queue into multiple batch calls once it exceeds this size. |
| `cache`        | `true`           | Share a per-key promise across repeated loads.                       |
| `cacheKeyFn`   | identity         | Derive cache/dedupe identity from a key (e.g. `(k) => k.id`).        |
| `schedule`     | `queueMicrotask` | Schedule the batch dispatch window.                                  |

### Methods

- `load(key): Promise<V>` — enqueue a key; resolves with its value or rejects
  with its `Error`.
- `loadMany(keys): Promise<Array<V | Error>>` — never rejects; returns a
  value-or-`Error` per key.
- `prime(key, value)` — seed the cache so a later `load` skips the batch. Does
  not overwrite an existing entry.
- `clear(key)` — evict one key.
- `clearAll()` — empty the cache.

## Caching semantics

- Repeated `load(sameKey)` returns the **identical** promise while caching is on.
- Duplicate keys in the same tick are deduped into one batch entry.
- A **failed** load is evicted from the cache, so a later `load` retries.

## License

MIT © Yronnel James
