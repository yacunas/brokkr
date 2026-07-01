/**
 * @brokkr/retry
 *
 * Resilience primitives for TypeScript backends, zero dependencies:
 *
 * - **Retry** — {@link retry} re-runs an async operation with exponential
 *   backoff and full jitter, with pluggable `shouldRetry`, `onRetry`,
 *   `AbortSignal`, and an injectable `sleep` for deterministic tests.
 * - **Timeout** — {@link withTimeout} races a promise (or thunk) against a
 *   deadline, rejecting with {@link TimeoutError}.
 * - **Circuit breaking** — {@link CircuitBreaker} fails fast with
 *   {@link CircuitOpenError} while a dependency is unhealthy, half-opening
 *   after a reset timeout. Its clock is injectable via `now`.
 */

export {
  retry,
  withTimeout,
  computeBackoff,
  CircuitBreaker,
  type RetryOptions,
  type Sleep,
  type CircuitState,
  type CircuitBreakerOptions,
} from "./retry";
export { TimeoutError, CircuitOpenError } from "./errors";
