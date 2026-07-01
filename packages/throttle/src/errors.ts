import type { RateLimitResult } from "./rate-limit";

/** Thrown by {@link RateLimiter.assert} when a request is denied. */
export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED";
  constructor(readonly result: RateLimitResult) {
    super(`Rate limit exceeded — retry in ${result.retryAfterMs}ms`);
    this.name = "RateLimitError";
  }
}
