# @brokkr/retry

Resilience primitives for TypeScript backends. Retry with exponential backoff and
full jitter, promise timeouts, and a circuit breaker. Zero runtime dependencies,
and deterministically testable — sleep, clock, and randomness are all injectable.

## Install

```sh
pnpm add @brokkr/retry
```

## `retry(fn, options?)`

Re-runs an async operation with exponential backoff plus full jitter. `fn`
receives the 1-based attempt number.

```ts
import { retry } from "@brokkr/retry";

const data = await retry((attempt) => fetchJson(url), {
  attempts: 5, // total tries (default 3)
  minDelayMs: 100, // base delay (default 100)
  maxDelayMs: 30_000, // per-delay cap (default 30_000)
  factor: 2, // exponential growth (default 2)
  jitter: true, // full jitter: random() * base (default true)
  shouldRetry: (error, attempt) => error instanceof NetworkError,
  onRetry: (error, attempt, delayMs) => log.warn({ attempt, delayMs }, error),
  signal: controller.signal, // aborts between attempts
});
```

Backoff for a 1-based `attempt` is
`min(maxDelayMs, minDelayMs * factor ** (attempt - 1))`, with full jitter
(`random() * base`) applied when `jitter` is enabled. The last error is rethrown
once attempts are exhausted or `shouldRetry` returns `false`; an aborted `signal`
rejects promptly.

For tests, pass `jitter: false` and a fake `sleep` to make timing deterministic:

```ts
const delays: number[] = [];
await retry(fn, { jitter: false, sleep: (ms) => (delays.push(ms), Promise.resolve()) });
```

## `withTimeout(input, ms)`

Races a promise (or a thunk returning one) against a deadline, rejecting with
`TimeoutError` if it does not settle in time. The underlying work is not
cancelled — it simply loses the race.

```ts
import { withTimeout, TimeoutError } from "@brokkr/retry";

try {
  const res = await withTimeout(() => fetch(url), 5_000);
} catch (err) {
  if (err instanceof TimeoutError) {
    /* err.code === "TIMEOUT" */
  }
}
```

## `CircuitBreaker`

Fails fast while a dependency is unhealthy.

```ts
import { CircuitBreaker, CircuitOpenError } from "@brokkr/retry";

const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 10_000 });

try {
  await breaker.run(() => callDependency());
} catch (err) {
  if (err instanceof CircuitOpenError) {
    /* err.code === "CIRCUIT_OPEN", err.retryAfterMs */
  }
}
```

States: `closed` (pass-through, counting consecutive failures) → `open` (reject
fast for `resetTimeoutMs`) → `half-open` (single trial; success closes it, failure
re-opens). Read the current state via `breaker.state`. Pass a fake `now` to drive
the reset timeout deterministically in tests.

## License

MIT © Yronnel James
