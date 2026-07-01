import { MemoryCache, type CacheStore } from "./store";

/**
 * Options accepted by {@link Cache}.
 *
 * @typeParam V - The type of values held in the cache.
 */
export interface CacheOptions<V> {
  /**
   * Backing store. Defaults to a fresh {@link MemoryCache} that shares this
   * cache's {@link CacheOptions.now | clock}.
   */
  store?: CacheStore<V>;

  /**
   * Clock used for stale-while-revalidate bookkeeping. Injectable for testing.
   * Defaults to {@link Date.now}.
   */
  now?: () => number;
}

/**
 * Options for {@link Cache.wrap}.
 */
export interface WrapOptions {
  /** Time-to-live for the loaded value, in milliseconds. */
  ttlMs?: number;
}

/**
 * Options for {@link Cache.staleWhileRevalidate}.
 */
export interface StaleWhileRevalidateOptions {
  /**
   * How long, in milliseconds, a value is considered *fresh*. Within this
   * window the cached value is returned without any background work.
   */
  ttlMs: number;

  /**
   * How long, in milliseconds, past `ttlMs` a value may still be served while a
   * refresh runs in the background. Once `ttlMs + staleMs` has elapsed the value
   * is gone and the next read blocks on a fresh load.
   */
  staleMs: number;
}

/**
 * A high-level cache facade over a {@link CacheStore}.
 *
 * On top of the plain store operations it adds two loader-driven patterns:
 *
 * - {@link Cache.wrap} — read-through caching with **single-flight**: many
 *   concurrent misses for the same key share a single loader invocation.
 * - {@link Cache.staleWhileRevalidate} — serve a slightly stale value instantly
 *   while refreshing it in the background, only blocking when nothing is cached.
 *
 * @typeParam V - The type of values held in the cache.
 *
 * @example
 * ```ts
 * const cache = new Cache<User>();
 * const user = await cache.wrap(`user:${id}`, () => db.loadUser(id), {
 *   ttlMs: 60_000,
 * });
 * ```
 */
export class Cache<V> {
  private readonly store: CacheStore<V>;
  private readonly now: () => number;

  /** In-flight loads, keyed by cache key, powering single-flight. */
  private readonly inflight = new Map<string, Promise<V>>();

  /** Timestamp (in `now()` units) at which each key was last written. */
  private readonly storedAt = new Map<string, number>();

  constructor(options: CacheOptions<V> = {}) {
    this.now = options.now ?? Date.now;
    this.store = options.store ?? new MemoryCache<V>({ now: this.now });
  }

  /** Read the raw cached value for `key`, if any. */
  async get(key: string): Promise<V | undefined> {
    return this.store.get(key);
  }

  /** Write `value` under `key`, optionally with a TTL in milliseconds. */
  async set(key: string, value: V, ttlMs?: number): Promise<void> {
    await this.store.set(key, value, ttlMs);
    this.storedAt.set(key, this.now());
  }

  /** Report whether `key` currently holds a live value. */
  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  /** Remove `key` from the cache. */
  async delete(key: string): Promise<boolean> {
    this.storedAt.delete(key);
    return this.store.delete(key);
  }

  /** Remove every entry from the cache. */
  async clear(): Promise<void> {
    this.storedAt.clear();
    this.inflight.clear();
    await this.store.clear();
  }

  /**
   * Read-through cache: return the cached value for `key`, or invoke `loader`
   * to produce it, store the result, and return it.
   *
   * Concurrent calls for the same *missing* key are collapsed into a single
   * loader invocation (single-flight); every caller resolves with the shared
   * result. This prevents a thundering herd of identical loads on a cold key.
   *
   * @typeParam T - The concrete value type returned by `loader`.
   * @param key - Cache key.
   * @param loader - Produces the value when the key is missing.
   * @param opts - Optional `ttlMs` applied to the stored value.
   */
  async wrap<T extends V>(key: string, loader: () => Promise<T>, opts?: WrapOptions): Promise<T> {
    const cached = await this.store.get(key);
    if (cached !== undefined) return cached as T;

    const value = await this.singleFlight(key, async () => {
      const loaded = await loader();
      await this.set(key, loaded, opts?.ttlMs);
      return loaded;
    });
    return value as T;
  }

  /**
   * Stale-while-revalidate read.
   *
   * - If nothing usable is cached, block on `loader`, store the result, and
   *   return it (single-flight).
   * - If a *fresh* value (younger than `ttlMs`) is cached, return it directly.
   * - If a *stale* value (older than `ttlMs` but within `ttlMs + staleMs`) is
   *   cached, return it immediately and kick off a background refresh so the
   *   next reader sees fresh data. Background refreshes are single-flighted, so
   *   a burst of stale reads triggers at most one reload.
   *
   * @param key - Cache key.
   * @param loader - Produces a fresh value.
   * @param opts - Freshness (`ttlMs`) and stale (`staleMs`) windows.
   */
  async staleWhileRevalidate(
    key: string,
    loader: () => Promise<V>,
    opts: StaleWhileRevalidateOptions,
  ): Promise<V> {
    const { ttlMs, staleMs } = opts;
    const totalTtl = ttlMs + staleMs;
    const cached = await this.store.get(key);

    if (cached === undefined) {
      // Nothing (or nothing live) to serve — block on a fresh load.
      return this.singleFlight(key, () => this.loadAndStore(key, loader, totalTtl));
    }

    const age = this.now() - (this.storedAt.get(key) ?? Number.NEGATIVE_INFINITY);
    if (age < ttlMs) {
      // Still fresh.
      return cached;
    }

    // Stale but serveable: refresh in the background, return the stale value now.
    void this.singleFlight(key, () => this.loadAndStore(key, loader, totalTtl)).catch(() => {
      // Swallow background refresh errors; the stale value was already served.
    });
    return cached;
  }

  /**
   * Register (or join) a single in-flight load for `key`. The runner is invoked
   * at most once while a load is outstanding; concurrent callers share its
   * promise. The entry is removed once the load settles.
   */
  private singleFlight(key: string, run: () => Promise<V>): Promise<V> {
    const existing = this.inflight.get(key);
    if (existing !== undefined) return existing;

    // No `await` between reading and writing `inflight`, so registration is
    // atomic with respect to other callers — this is what guarantees
    // single-flight semantics.
    const promise = run().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async loadAndStore(key: string, loader: () => Promise<V>, ttlMs: number): Promise<V> {
    const value = await loader();
    await this.set(key, value, ttlMs);
    return value;
  }
}
