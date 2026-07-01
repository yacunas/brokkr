import { RateLimitError } from "./errors";
import { MemoryStore, type RateLimitStore } from "./store";

export type RateLimitAlgorithm = "token-bucket" | "sliding-window" | "fixed-window";

export interface RateLimiterOptions {
  /** Maximum number of units permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * - `token-bucket` (default): smooth, allows short bursts, refills continuously.
   * - `sliding-window`: precise rolling window (keeps a timestamp log).
   * - `fixed-window`: cheapest; counts reset on window boundaries (edge bursts).
   */
  algorithm?: RateLimitAlgorithm;
  /** State backend. Defaults to an in-process {@link MemoryStore}. */
  store?: RateLimitStore;
  /** Clock, for testing. Defaults to `Date.now`. */
  now?: () => number;
}

/** The outcome of a {@link RateLimiter.consume} call. */
export interface RateLimitResult {
  allowed: boolean;
  /** The configured limit. */
  limit: number;
  /** Units left in the current window. */
  remaining: number;
  /** Milliseconds until the request would be allowed (0 when allowed). */
  retryAfterMs: number;
  /** Epoch ms at which capacity is (fully or partially) restored. */
  resetAt: number;
}

/**
 * A keyed rate limiter. One instance enforces one policy across many keys
 * (per-user, per-IP, per-endpoint, …).
 *
 * @example
 * const limiter = new RateLimiter({ limit: 100, windowMs: 60_000 });
 * const { allowed, retryAfterMs } = await limiter.consume(`ip:${ip}`);
 * if (!allowed) reply.header("Retry-After", Math.ceil(retryAfterMs / 1000));
 */
export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly algorithm: RateLimitAlgorithm;
  private readonly store: RateLimitStore;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    if (!Number.isFinite(options.limit) || options.limit < 1) {
      throw new RangeError(`limit must be >= 1, got ${options.limit}`);
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs < 1) {
      throw new RangeError(`windowMs must be >= 1, got ${options.windowMs}`);
    }
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.algorithm = options.algorithm ?? "token-bucket";
    this.now = options.now ?? Date.now;
    this.store = options.store ?? new MemoryStore(this.now);
  }

  /** Try to consume `cost` units for `key`. Never throws on denial — inspect `.allowed`. */
  async consume(key: string, cost = 1): Promise<RateLimitResult> {
    if (!Number.isFinite(cost) || cost < 1) {
      throw new RangeError(`cost must be >= 1, got ${cost}`);
    }
    switch (this.algorithm) {
      case "sliding-window":
        return this.slidingWindow(key, cost);
      case "fixed-window":
        return this.fixedWindow(key, cost);
      case "token-bucket":
      default:
        return this.tokenBucket(key, cost);
    }
  }

  /** Like {@link RateLimiter.consume} but throws {@link RateLimitError} when denied. */
  async assert(key: string, cost = 1): Promise<RateLimitResult> {
    const result = await this.consume(key, cost);
    if (!result.allowed) throw new RateLimitError(result);
    return result;
  }

  /** Forget a key's state (e.g. after a successful login resets a lockout). */
  async reset(key: string): Promise<void> {
    await this.store.delete(key);
  }

  private async tokenBucket(key: string, cost: number): Promise<RateLimitResult> {
    const now = this.now();
    const state = (await this.store.get<{ tokens: number; updatedAt: number }>(key)) ?? {
      tokens: this.limit,
      updatedAt: now,
    };
    const ratePerMs = this.limit / this.windowMs;
    const tokens = Math.min(this.limit, state.tokens + (now - state.updatedAt) * ratePerMs);

    if (tokens >= cost) {
      const remaining = tokens - cost;
      await this.store.set(key, { tokens: remaining, updatedAt: now }, this.windowMs);
      return {
        allowed: true,
        limit: this.limit,
        remaining: Math.floor(remaining),
        retryAfterMs: 0,
        resetAt: now + Math.ceil((this.limit - remaining) / ratePerMs),
      };
    }

    const retryAfterMs = Math.ceil((cost - tokens) / ratePerMs);
    await this.store.set(key, { tokens, updatedAt: now }, this.windowMs);
    return {
      allowed: false,
      limit: this.limit,
      remaining: Math.floor(tokens),
      retryAfterMs,
      resetAt: now + retryAfterMs,
    };
  }

  private async fixedWindow(key: string, cost: number): Promise<RateLimitResult> {
    const now = this.now();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const resetAt = windowStart + this.windowMs;
    const state = await this.store.get<{ count: number; windowStart: number }>(key);
    const count = state && state.windowStart === windowStart ? state.count : 0;

    if (count + cost <= this.limit) {
      await this.store.set(key, { count: count + cost, windowStart }, resetAt - now);
      return {
        allowed: true,
        limit: this.limit,
        remaining: this.limit - count - cost,
        retryAfterMs: 0,
        resetAt,
      };
    }
    return {
      allowed: false,
      limit: this.limit,
      remaining: this.limit - count,
      retryAfterMs: resetAt - now,
      resetAt,
    };
  }

  private async slidingWindow(key: string, cost: number): Promise<RateLimitResult> {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const previous = (await this.store.get<number[]>(key)) ?? [];
    const timestamps = previous.filter((t) => t > windowStart);

    if (timestamps.length + cost <= this.limit) {
      for (let i = 0; i < cost; i++) timestamps.push(now);
      await this.store.set(key, timestamps, this.windowMs);
      return {
        allowed: true,
        limit: this.limit,
        remaining: this.limit - timestamps.length,
        retryAfterMs: 0,
        resetAt: (timestamps[0] ?? now) + this.windowMs,
      };
    }

    await this.store.set(key, timestamps, this.windowMs);
    const oldest = timestamps[0] ?? now;
    return {
      allowed: false,
      limit: this.limit,
      remaining: Math.max(0, this.limit - timestamps.length),
      retryAfterMs: Math.max(0, oldest + this.windowMs - now),
      resetAt: oldest + this.windowMs,
    };
  }
}
