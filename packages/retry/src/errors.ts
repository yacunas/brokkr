/** Thrown by {@link withTimeout} when the wrapped work does not settle in time. */
export class TimeoutError extends Error {
  readonly code = "TIMEOUT";
  constructor(
    /** The timeout budget that elapsed, in milliseconds. */
    readonly timeoutMs: number,
  ) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/** Thrown by {@link CircuitBreaker.run} when the breaker is open and rejecting fast. */
export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN";
  constructor(
    /** Milliseconds until the breaker will next allow a half-open trial. */
    readonly retryAfterMs: number,
  ) {
    super(`Circuit is open — retry in ${retryAfterMs}ms`);
    this.name = "CircuitOpenError";
  }
}
