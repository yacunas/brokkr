/**
 * A single queued load awaiting the next batch dispatch.
 */
interface QueuedLoad<K, V> {
  readonly key: K;
  readonly resolve: (value: V) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Options controlling batching, caching, and scheduling behaviour of a
 * {@link DataLoader}.
 */
export interface DataLoaderOptions<K> {
  /**
   * The maximum number of keys handed to `batchFn` in a single call. When the
   * pending queue exceeds this, it is split into multiple sequential batch
   * calls. Must be a positive integer. Defaults to `Infinity` (no limit).
   */
  readonly maxBatchSize?: number;

  /**
   * Whether repeated loads of the same key share (and are served from) a
   * per-key promise cache. Defaults to `true`.
   */
  readonly cache?: boolean;

  /**
   * Derives the cache/dedupe identity for a key. Two keys with equal cache
   * keys (by `Map` equality) are treated as the same key. Defaults to the
   * identity function.
   */
  readonly cacheKeyFn?: (key: K) => unknown;

  /**
   * Schedules the batch dispatch. Called once per batch window with a callback
   * that must eventually run. Defaults to {@link queueMicrotask}, which
   * coalesces every synchronous `load` in the current tick into one batch.
   */
  readonly schedule?: (cb: () => void) => void;
}

/**
 * The function that resolves a batch of keys. It receives the exact keys that
 * were enqueued (in order) and must return a promise for an array of the same
 * length, where element `i` corresponds to key `i`. An element may be an
 * `Error` to indicate that individual key failed without failing its siblings.
 */
export type BatchLoadFn<K, V> = (keys: readonly K[]) => Promise<ReadonlyArray<V | Error>>;

/**
 * Batches and caches asynchronous loads by key to eliminate N+1 access
 * patterns.
 *
 * Every `load` made within the same scheduling window (a microtask by default)
 * is coalesced into a single call to the `batchFn`, dramatically reducing the
 * number of round-trips to an underlying data source. Results are matched back
 * to their keys by index. A per-key promise cache (enabled by default) dedupes
 * concurrent and repeated loads of the same key.
 *
 * @typeParam K - The key type used to load values.
 * @typeParam V - The resolved value type.
 *
 * @example
 * ```ts
 * const users = new DataLoader<string, User>(async (ids) => {
 *   const rows = await db.users.findMany({ id: { in: ids } });
 *   const byId = new Map(rows.map((r) => [r.id, r]));
 *   return ids.map((id) => byId.get(id) ?? new Error(`No user ${id}`));
 * });
 *
 * // Both loads are dispatched in ONE batchFn call.
 * const [a, b] = await Promise.all([users.load("1"), users.load("2")]);
 * ```
 */
export class DataLoader<K, V> {
  readonly #batchFn: BatchLoadFn<K, V>;
  readonly #maxBatchSize: number;
  readonly #cacheEnabled: boolean;
  readonly #cacheKeyFn: (key: K) => unknown;
  readonly #schedule: (cb: () => void) => void;

  /** Per-key promise cache, keyed by `cacheKeyFn(key)`. */
  readonly #cache = new Map<unknown, Promise<V>>();

  /** Keys enqueued for the next batch dispatch. */
  #queue: Array<QueuedLoad<K, V>> = [];

  /** Whether a dispatch has already been scheduled for the current queue. */
  #dispatchScheduled = false;

  /**
   * @param batchFn - Resolves a batch of keys to an index-aligned array of
   *   values or `Error`s. See {@link BatchLoadFn}.
   * @param options - See {@link DataLoaderOptions}.
   */
  constructor(batchFn: BatchLoadFn<K, V>, options: DataLoaderOptions<K> = {}) {
    if (typeof batchFn !== "function") {
      throw new TypeError("DataLoader requires a batch function as its first argument.");
    }

    const maxBatchSize = options.maxBatchSize ?? Infinity;
    if (!(maxBatchSize > 0)) {
      throw new TypeError(`maxBatchSize must be a positive number, received ${maxBatchSize}.`);
    }

    this.#batchFn = batchFn;
    this.#maxBatchSize = maxBatchSize;
    this.#cacheEnabled = options.cache ?? true;
    this.#cacheKeyFn = options.cacheKeyFn ?? ((key) => key);
    this.#schedule = options.schedule ?? queueMicrotask;
  }

  /**
   * Loads a value for `key`, enqueuing it for the next batch dispatch. All
   * loads made in the same scheduling window are dispatched to `batchFn` in a
   * single call. When caching is enabled, repeated loads of the same key return
   * the identical promise.
   *
   * @returns A promise that resolves with the value, or rejects if the batch
   *   returned an `Error` for this key (or the batch itself failed).
   */
  load(key: K): Promise<V> {
    const cacheKey = this.#cacheKeyFn(key);

    if (this.#cacheEnabled) {
      const cached = this.#cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const promise = new Promise<V>((resolve, reject) => {
      this.#queue.push({ key, resolve, reject });
      this.#scheduleDispatch();
    });

    if (this.#cacheEnabled) {
      this.#cache.set(cacheKey, promise);
      // Evict failed loads so they can be retried on a subsequent load.
      promise.catch(() => {
        if (this.#cache.get(cacheKey) === promise) {
          this.#cache.delete(cacheKey);
        }
      });
    }

    return promise;
  }

  /**
   * Loads many keys at once. Unlike {@link load}, this never rejects: each
   * element of the result is either the resolved value or the `Error` that key
   * failed with, positionally aligned with `keys`.
   */
  async loadMany(keys: readonly K[]): Promise<Array<V | Error>> {
    return Promise.all(
      keys.map((key) =>
        this.load(key).catch((error: unknown) =>
          error instanceof Error ? error : new Error(String(error)),
        ),
      ),
    );
  }

  /**
   * Removes `key` from the cache so its next load hits `batchFn` again. No-op
   * when caching is disabled or the key is absent.
   */
  clear(key: K): this {
    this.#cache.delete(this.#cacheKeyFn(key));
    return this;
  }

  /**
   * Empties the entire cache.
   */
  clearAll(): this {
    this.#cache.clear();
    return this;
  }

  /**
   * Primes the cache with an already-known value (or a resolved promise for
   * one), so a subsequent {@link load} of `key` resolves immediately without a
   * batch call. Does not overwrite an existing cache entry — {@link clear} it
   * first if you intend to replace it. No-op when caching is disabled.
   */
  prime(key: K, value: V | Promise<V>): this {
    if (!this.#cacheEnabled) {
      return this;
    }
    const cacheKey = this.#cacheKeyFn(key);
    if (!this.#cache.has(cacheKey)) {
      this.#cache.set(cacheKey, Promise.resolve(value));
    }
    return this;
  }

  #scheduleDispatch(): void {
    if (this.#dispatchScheduled) {
      return;
    }
    this.#dispatchScheduled = true;
    this.#schedule(() => {
      this.#dispatchScheduled = false;
      this.#dispatchQueue();
    });
  }

  #dispatchQueue(): void {
    const queue = this.#queue;
    this.#queue = [];
    if (queue.length === 0) {
      return;
    }

    if (queue.length <= this.#maxBatchSize) {
      void this.#dispatchBatch(queue);
      return;
    }

    for (let i = 0; i < queue.length; i += this.#maxBatchSize) {
      void this.#dispatchBatch(queue.slice(i, i + this.#maxBatchSize));
    }
  }

  async #dispatchBatch(batch: ReadonlyArray<QueuedLoad<K, V>>): Promise<void> {
    const keys = batch.map((item) => item.key);

    let results: ReadonlyArray<V | Error>;
    try {
      results = await this.#batchFn(keys);
    } catch (error) {
      for (const item of batch) {
        item.reject(error);
      }
      return;
    }

    if (!Array.isArray(results)) {
      const error = new TypeError(
        `DataLoader batch function must return an array, received ${typeof results}.`,
      );
      for (const item of batch) {
        item.reject(error);
      }
      return;
    }

    if (results.length !== batch.length) {
      const error = new TypeError(
        `DataLoader batch function returned an array of length ${results.length}, ` +
          `but ${batch.length} keys were requested. The result must align by index with the keys.`,
      );
      for (const item of batch) {
        item.reject(error);
      }
      return;
    }

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i]!;
      const result = results[i]!;
      if (result instanceof Error) {
        item.reject(result);
      } else {
        item.resolve(result);
      }
    }
  }
}
