/**
 * @brokkr/throttle
 *
 * Two kinds of throttling for TypeScript backends, zero dependencies:
 *
 * - **Concurrency limiting** — {@link pool} / {@link mapLimit} / {@link settleLimit}
 *   run many async tasks with a bounded number in flight (backpressure + results).
 * - **Rate limiting** — {@link RateLimiter} enforces requests-per-window per key,
 *   with token-bucket / sliding-window / fixed-window algorithms and a pluggable
 *   {@link RateLimitStore} (in-memory by default, Redis-ready).
 */

export { pool, mapLimit, settleLimit, type Pool } from "./concurrency";
export {
  RateLimiter,
  type RateLimiterOptions,
  type RateLimitResult,
  type RateLimitAlgorithm,
} from "./rate-limit";
export { MemoryStore, type RateLimitStore } from "./store";
export { RateLimitError } from "./errors";
