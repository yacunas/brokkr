import { describe, expect, it } from "vitest";
import { RateLimitError, RateLimiter } from "./index";

/** A deterministic, advanceable clock. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("token-bucket", () => {
  it("allows a burst up to the limit, then denies", async () => {
    const c = clock();
    const rl = new RateLimiter({ limit: 3, windowMs: 3000, algorithm: "token-bucket", now: c.now });
    expect((await rl.consume("k")).allowed).toBe(true);
    expect((await rl.consume("k")).allowed).toBe(true);
    expect((await rl.consume("k")).allowed).toBe(true);

    const denied = await rl.consume("k");
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills continuously over time", async () => {
    const c = clock();
    const rl = new RateLimiter({ limit: 2, windowMs: 2000, now: c.now }); // 1 token / 1000ms
    await rl.consume("k");
    await rl.consume("k");
    expect((await rl.consume("k")).allowed).toBe(false);

    c.advance(1000); // one token restored
    expect((await rl.consume("k")).allowed).toBe(true);
    expect((await rl.consume("k")).allowed).toBe(false);
  });
});

describe("fixed-window", () => {
  it("resets on window boundaries", async () => {
    const c = clock(0);
    const rl = new RateLimiter({ limit: 2, windowMs: 1000, algorithm: "fixed-window", now: c.now });
    expect((await rl.consume("k")).allowed).toBe(true);
    expect((await rl.consume("k")).allowed).toBe(true);
    expect((await rl.consume("k")).allowed).toBe(false);

    c.advance(1000); // next window
    expect((await rl.consume("k")).allowed).toBe(true);
  });
});

describe("sliding-window", () => {
  it("enforces a precise rolling window", async () => {
    const c = clock(0);
    const rl = new RateLimiter({
      limit: 2,
      windowMs: 1000,
      algorithm: "sliding-window",
      now: c.now,
    });
    expect((await rl.consume("k")).allowed).toBe(true); // t=0
    c.advance(500);
    expect((await rl.consume("k")).allowed).toBe(true); // t=500
    expect((await rl.consume("k")).allowed).toBe(false); // two in the last 1000ms

    c.advance(600); // t=1100 → the t=0 hit rolled out of the window
    expect((await rl.consume("k")).allowed).toBe(true);
  });
});

describe("common behavior", () => {
  it("supports a cost per call, and assert throws on denial", async () => {
    const c = clock();
    const rl = new RateLimiter({ limit: 5, windowMs: 1000, algorithm: "fixed-window", now: c.now });
    expect((await rl.consume("k", 5)).allowed).toBe(true);
    await expect(rl.assert("k")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("isolates keys from one another", async () => {
    const c = clock();
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, algorithm: "fixed-window", now: c.now });
    expect((await rl.consume("a")).allowed).toBe(true);
    expect((await rl.consume("b")).allowed).toBe(true);
    expect((await rl.consume("a")).allowed).toBe(false);
  });

  it("reset clears a key's state", async () => {
    const c = clock();
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, algorithm: "fixed-window", now: c.now });
    await rl.consume("k");
    expect((await rl.consume("k")).allowed).toBe(false);
    await rl.reset("k");
    expect((await rl.consume("k")).allowed).toBe(true);
  });

  it("validates options and cost", async () => {
    expect(() => new RateLimiter({ limit: 0, windowMs: 1000 })).toThrow(RangeError);
    expect(() => new RateLimiter({ limit: 1, windowMs: 0 })).toThrow(RangeError);
    const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
    await expect(rl.consume("k", 0)).rejects.toThrow(RangeError);
  });
});
