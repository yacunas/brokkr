/**
 * The storage contract behind a {@link Cache}.
 *
 * Every method is asynchronous so that the same interface can be backed by an
 * in-process map ({@link MemoryCache}) or a remote store such as Redis without
 * changing any calling code.
 *
 * @typeParam V - The type of values held in the store.
 */
export interface CacheStore<V> {
  /**
   * Return the value stored under `key`, or `undefined` if the key is missing
   * or has expired.
   */
  get(key: string): Promise<V | undefined>;

  /**
   * Store `value` under `key`.
   *
   * @param ttlMs - Optional time-to-live in milliseconds. When provided the
   *   entry expires that many milliseconds after it is written. When omitted the
   *   entry never expires on its own.
   */
  set(key: string, value: V, ttlMs?: number): Promise<void>;

  /**
   * Remove `key` from the store.
   *
   * @returns `true` if a live entry was removed, `false` if there was nothing to
   *   remove (including entries that had already expired).
   */
  delete(key: string): Promise<boolean>;

  /**
   * Report whether `key` currently holds a live (non-expired) value.
   */
  has(key: string): Promise<boolean>;

  /**
   * Remove every entry from the store.
   */
  clear(): Promise<void>;
}

interface Entry<V> {
  value: V;
  /** Absolute expiry timestamp in `now()` units, or `undefined` for no expiry. */
  expiresAt: number | undefined;
}

/**
 * Options for {@link MemoryCache}.
 */
export interface MemoryCacheOptions {
  /**
   * Maximum number of live entries to retain. When a `set` would exceed this
   * size the least-recently-used entry is evicted. Defaults to `Infinity`
   * (no eviction).
   */
  maxSize?: number;

  /**
   * Clock used for TTL bookkeeping. Injectable for testing. Defaults to
   * {@link Date.now}.
   */
  now?: () => number;
}

/**
 * An in-memory {@link CacheStore} with least-recently-used eviction and
 * per-entry TTL.
 *
 * Recency is tracked using the insertion order of a `Map`: touching an entry
 * (via {@link MemoryCache.get}) moves it to the most-recently-used position, so
 * the first key in iteration order is always the eviction candidate. TTL is
 * enforced lazily — expired entries are detected and dropped on access rather
 * than via a timer.
 *
 * @typeParam V - The type of values held in the cache.
 *
 * @example
 * ```ts
 * const cache = new MemoryCache<number>({ maxSize: 100 });
 * await cache.set("a", 1, 5_000); // expires in 5s
 * await cache.get("a"); // 1
 * ```
 */
export class MemoryCache<V> implements CacheStore<V> {
  private readonly map = new Map<string, Entry<V>>();
  private readonly maxSize: number;
  private readonly now: () => number;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxSize = options.maxSize ?? Infinity;
    this.now = options.now ?? Date.now;
  }

  /**
   * Number of entries currently held, including any that have expired but have
   * not yet been lazily evicted.
   */
  get size(): number {
    return this.map.size;
  }

  async get(key: string): Promise<V | undefined> {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;

    if (this.isExpired(entry)) {
      this.map.delete(key);
      return undefined;
    }

    // Refresh recency: re-inserting moves the key to the newest position.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: V, ttlMs?: number): Promise<void> {
    // Delete first so re-inserting places the key at the newest position.
    this.map.delete(key);
    this.map.set(key, {
      value,
      expiresAt: ttlMs === undefined ? undefined : this.now() + ttlMs,
    });
    this.evictIfNeeded();
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.map.get(key);
    if (entry === undefined) return false;
    this.map.delete(key);
    // An already-expired entry is treated as if it were not there.
    return !this.isExpired(entry);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.map.get(key);
    if (entry === undefined) return false;
    if (this.isExpired(entry)) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  private isExpired(entry: Entry<V>): boolean {
    return entry.expiresAt !== undefined && this.now() >= entry.expiresAt;
  }

  private evictIfNeeded(): void {
    while (this.map.size > this.maxSize) {
      // Map iteration order is insertion order, so the first key is the LRU.
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      this.map.delete(oldest.value);
    }
  }
}
