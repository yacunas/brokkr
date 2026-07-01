import { CircuitOpenError, TimeoutError } from "./errors";

/**
 * Sleep for `ms` milliseconds. Injectable so tests can capture delays and run
 * without real timers.
 */
export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Options for {@link retry}. All fields are optional and have sensible defaults. */
export interface RetryOptions {
  /** Total number of tries (not additional retries). Default `3`. */
  attempts?: number;
  /** Base delay for the first backoff step, in milliseconds. Default `100`. */
  minDelayMs?: number;
  /** Upper bound on any single backoff delay, in milliseconds. Default `30_000`. */
  maxDelayMs?: number;
  /** Exponential growth factor between attempts. Default `2`. */
  factor?: number;
  /**
   * Apply full jitter to each backoff delay (`random() * base`). Disable for
   * deterministic tests. Default `true`.
   */
  jitter?: boolean;
  /**
   * Decide whether a given error should trigger another attempt. Return `false`
   * to stop immediately and rethrow. Default: always retry.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before each backoff sleep with the error, the attempt that failed, and the chosen delay. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Abort between attempts. When aborted the returned promise rejects promptly. */
  signal?: AbortSignal;
  /** Injectable sleep. Default is a `setTimeout`-based sleep. */
  sleep?: Sleep;
  /** Injectable randomness in `[0, 1)`, used for jitter. Default `Math.random`. */
  random?: () => number;
}

/**
 * Compute the exponential backoff delay for a 1-based `attempt`.
 *
 * `base = min(maxDelayMs, minDelayMs * factor ** (attempt - 1))`, then full
 * jitter (`random() * base`) is applied when `jitter` is enabled.
 */
export function computeBackoff(
  attempt: number,
  options: Pick<RetryOptions, "minDelayMs" | "maxDelayMs" | "factor" | "jitter" | "random">,
): number {
  const minDelayMs = options.minDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const factor = options.factor ?? 2;
  const jitter = options.jitter ?? true;
  const random = options.random ?? Math.random;

  const base = Math.min(maxDelayMs, minDelayMs * factor ** (attempt - 1));
  return jitter ? random() * base : base;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted", "AbortError");
  }
}

/**
 * Run `fn` with retries and exponential backoff plus full jitter.
 *
 * `fn` receives the 1-based attempt number. On failure the error is passed to
 * {@link RetryOptions.shouldRetry} (default: always retry); if retryable and
 * attempts remain, {@link RetryOptions.onRetry} fires and the caller sleeps for
 * the computed backoff before the next try. When attempts are exhausted, or
 * `shouldRetry` returns `false`, the last error is rethrown. If the provided
 * `signal` aborts, the promise rejects promptly with the abort reason.
 *
 * @example
 * const data = await retry((attempt) => fetchJson(url), {
 *   attempts: 5,
 *   shouldRetry: (err) => err instanceof NetworkError,
 * });
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const shouldRetry = options.shouldRetry ?? (() => true);
  const sleep = options.sleep ?? defaultSleep;
  const { signal, onRetry } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= attempts;
      if (isLastAttempt || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delayMs = computeBackoff(attempt, options);
      onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
      throwIfAborted(signal);
    }
  }
  // Unreachable when attempts >= 1; guards the attempts === 0 edge.
  throw lastError;
}

/**
 * Reject with {@link TimeoutError} if `input` does not settle within `ms`.
 *
 * `input` may be a promise or a thunk returning one; a thunk defers work
 * creation until the timeout race is armed. The underlying promise is not
 * cancelled — it simply loses the race.
 *
 * @example
 * const res = await withTimeout(() => fetch(url), 5_000);
 */
export function withTimeout<T>(input: Promise<T> | (() => Promise<T>), ms: number): Promise<T> {
  const promise = typeof input === "function" ? input() : input;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Runtime state of a {@link CircuitBreaker}. */
export type CircuitState = "closed" | "open" | "half-open";

/** Options for {@link CircuitBreaker}. */
export interface CircuitBreakerOptions {
  /** Consecutive failures in the closed state that trip the breaker open. */
  failureThreshold: number;
  /** How long the breaker stays open before allowing a half-open trial, in milliseconds. */
  resetTimeoutMs: number;
  /** Injectable clock in milliseconds. Default `Date.now`. */
  now?: () => number;
}

/**
 * A circuit breaker that fails fast while a dependency is unhealthy.
 *
 * - **closed** — calls pass through; consecutive failures are counted. Reaching
 *   `failureThreshold` trips the breaker **open**.
 * - **open** — calls reject immediately with {@link CircuitOpenError} until
 *   `resetTimeoutMs` elapses since it opened, then the next call is allowed as a
 *   **half-open** trial.
 * - **half-open** — a single trial runs; success closes the breaker and resets
 *   the failure count, failure re-opens it and restarts the reset timer.
 *
 * Pass a fake `now` to drive the timeout deterministically in tests.
 */
export class CircuitBreaker {
  #state: CircuitState = "closed";
  #failures = 0;
  #openedAt = 0;
  readonly #failureThreshold: number;
  readonly #resetTimeoutMs: number;
  readonly #now: () => number;

  constructor(options: CircuitBreakerOptions) {
    this.#failureThreshold = options.failureThreshold;
    this.#resetTimeoutMs = options.resetTimeoutMs;
    this.#now = options.now ?? Date.now;
  }

  /** The current breaker state, re-evaluated for an elapsed reset timeout. */
  get state(): CircuitState {
    if (this.#state === "open" && this.#now() - this.#openedAt >= this.#resetTimeoutMs) {
      return "half-open";
    }
    return this.#state;
  }

  /**
   * Run `fn` through the breaker. Rejects immediately with
   * {@link CircuitOpenError} while open and within the reset timeout; otherwise
   * runs `fn` and updates state based on the outcome.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#state === "open") {
      const elapsed = this.#now() - this.#openedAt;
      if (elapsed < this.#resetTimeoutMs) {
        throw new CircuitOpenError(this.#resetTimeoutMs - elapsed);
      }
      this.#state = "half-open";
    }

    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (error) {
      this.#onFailure();
      throw error;
    }
  }

  #onSuccess(): void {
    this.#failures = 0;
    this.#state = "closed";
  }

  #onFailure(): void {
    if (this.#state === "half-open") {
      this.#trip();
      return;
    }
    this.#failures++;
    if (this.#failures >= this.#failureThreshold) {
      this.#trip();
    }
  }

  #trip(): void {
    this.#state = "open";
    this.#openedAt = this.#now();
  }
}
