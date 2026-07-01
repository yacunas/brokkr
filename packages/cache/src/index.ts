/**
 * @brokkr/cache
 *
 * A small caching abstraction for TypeScript backends, zero dependencies:
 *
 * - **{@link CacheStore}** — an async storage contract (`get` / `set` /
 *   `delete` / `has` / `clear`) that an in-memory map or a remote store such as
 *   Redis can implement interchangeably.
 * - **{@link MemoryCache}** — an in-process store with least-recently-used
 *   eviction (`maxSize`) and per-entry TTL (lazy expiry), with an injectable
 *   clock for testing.
 * - **{@link Cache}** — a facade over any `CacheStore` adding read-through
 *   {@link Cache.wrap | single-flight caching} and
 *   {@link Cache.staleWhileRevalidate | stale-while-revalidate}.
 */

export { MemoryCache, type CacheStore, type MemoryCacheOptions } from "./store";
export {
  Cache,
  type CacheOptions,
  type WrapOptions,
  type StaleWhileRevalidateOptions,
} from "./cache";
