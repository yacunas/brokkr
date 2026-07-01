# @brokkr/cache

A small caching abstraction for TypeScript backends. Zero runtime dependencies.

- **`CacheStore<V>`** — an async storage contract (`get` / `set` / `delete` /
  `has` / `clear`). Because every method is async, the same interface works for
  an in-process map or a remote store such as Redis.
- **`MemoryCache<V>`** — an in-process `CacheStore` with least-recently-used
  eviction (`maxSize`) and per-entry TTL (lazy expiry). The clock is injectable
  for testing.
- **`Cache<V>`** — a facade over any `CacheStore` that adds read-through
  single-flight caching and stale-while-revalidate.

## Install

```sh
pnpm add @brokkr/cache
```

## Quick start

```ts
import { Cache } from "@brokkr/cache";

const cache = new Cache<User>();

const user = await cache.wrap(`user:${id}`, () => db.loadUser(id), {
  ttlMs: 60_000,
});
```

## `MemoryCache`

```ts
import { MemoryCache } from "@brokkr/cache";

const store = new MemoryCache<number>({ maxSize: 1_000 });

await store.set("a", 1, 5_000); // expires 5s from now
await store.get("a"); // 1  (also refreshes recency)
await store.has("a"); // true
await store.delete("a"); // true
await store.clear();
```

- **LRU eviction** — once `maxSize` is exceeded, the least-recently-used entry
  is evicted. A successful `get` moves the key to the most-recently-used
  position, so hot keys survive.
- **TTL** — pass `ttlMs` to `set`; entries expire lazily on the next access
  after `now() >= expiresAt`.
- **Injectable clock** — pass `now: () => number` to drive TTL from a test clock.

## `Cache.wrap` — read-through with single-flight

Returns the cached value or invokes `loader` to produce, store, and return it.
Concurrent calls for the same _missing_ key share **one** loader invocation, so
a cold key never triggers a thundering herd.

```ts
const value = await cache.wrap("key", loader, { ttlMs: 30_000 });
```

## `Cache.staleWhileRevalidate` — serve stale, refresh in the background

```ts
const value = await cache.staleWhileRevalidate("key", loader, {
  ttlMs: 1_000, // considered fresh for 1s
  staleMs: 5_000, // may be served stale for 5s more while refreshing
});
```

- **Fresh** (age `< ttlMs`) → the cached value is returned directly.
- **Stale** (age within `ttlMs … ttlMs + staleMs`) → the cached value is
  returned immediately and a background refresh runs (single-flighted, so a
  burst of stale reads triggers at most one reload).
- **Expired** (age `≥ ttlMs + staleMs`) → the call blocks on a fresh load.

## Custom store

`Cache` accepts any `CacheStore`, so you can back it with Redis or another
implementation:

```ts
import { Cache, type CacheStore } from "@brokkr/cache";

class RedisStore<V> implements CacheStore<V> {
  /* get / set / delete / has / clear backed by Redis */
}

const cache = new Cache<string>({ store: new RedisStore<string>() });
```

## License

MIT © Yronnel James
