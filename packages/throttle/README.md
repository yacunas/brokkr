# @brokkr/throttle

> Concurrency limiting and rate limiting for TypeScript backends. Zero dependencies.

Two distinct throttling needs, one small package:

- **Concurrency limiting** — run many async tasks with a bounded number in flight.
- **Rate limiting** — enforce requests-per-window per key (per-user/IP/endpoint).

## Concurrency

```ts
import { pool, mapLimit, settleLimit } from "@brokkr/throttle";

// A reusable bounded pool with backpressure.
const p = pool(5);
const rows = await Promise.all(ids.map((id) => p.run(() => fetchRow(id))));
await p.onIdle();

// Or map with a concurrency cap (output stays in input order).
const results = await mapLimit(urls, 8, (url) => fetch(url));

// Never-reject variant — a settled result per item.
const settled = await settleLimit(jobs, 4, (job) => run(job));
```

## Rate limiting

```ts
import { RateLimiter } from "@brokkr/throttle";

const limiter = new RateLimiter({ limit: 100, windowMs: 60_000 }); // 100 / minute

const { allowed, remaining, retryAfterMs } = await limiter.consume(`ip:${ip}`);
if (!allowed) {
  reply.header("Retry-After", Math.ceil(retryAfterMs / 1000)).code(429);
}

// Or throw a typed error to let a filter/guard handle it:
await limiter.assert(`user:${userId}`); // throws RateLimitError when denied
```

### Algorithms

| `algorithm` | Behavior | Use when |
| --- | --- | --- |
| `token-bucket` (default) | Smooth; allows short bursts, refills continuously | General API throttling |
| `sliding-window` | Precise rolling window (timestamp log) | Strict fairness matters |
| `fixed-window` | Cheapest; counters reset on boundaries | High volume, edge bursts OK |

### Pluggable store

State lives in an in-process `MemoryStore` by default. Implement `RateLimitStore`
to share limits across instances (e.g. Redis: `get`→`GET`, `set(…, ttlMs)`→`SET PX`):

```ts
const limiter = new RateLimiter({ limit: 100, windowMs: 60_000, store: myRedisStore });
```

Pass `now: () => number` to inject a clock in tests.

## License

MIT © Yronnel James
