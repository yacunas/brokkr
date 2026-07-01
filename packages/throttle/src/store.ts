/**
 * Where a {@link RateLimiter} keeps its per-key state. The default is
 * {@link MemoryStore}; implement this interface to back it with Redis, etc.
 * (e.g. `get` → `GET`, `set` with `ttlMs` → `SET PX`).
 */
export interface RateLimitStore {
  get<S>(key: string): Promise<S | undefined>;
  set<S>(key: string, value: S, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** In-process store with lazy TTL expiry. Fine for a single instance / tests. */
export class MemoryStore implements RateLimitStore {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get<S>(key: string): Promise<S | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as S;
  }

  async set<S>(key: string, value: S, ttlMs: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
