import { describe, expect, it, vi } from "vitest";
import { Cache, MemoryCache } from "./index";

/** A hand-cranked clock so TTL behaviour is deterministic in tests. */
function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** Flush pending microtasks/macrotasks so background work can settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("MemoryCache", () => {
  it("round-trips set/get", async () => {
    const cache = new MemoryCache<number>();
    await cache.set("a", 1);
    expect(await cache.get("a")).toBe(1);
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("expires entries after their TTL (lazy)", async () => {
    const clock = makeClock();
    const cache = new MemoryCache<string>({ now: clock.now });

    await cache.set("k", "v", 1_000);
    expect(await cache.get("k")).toBe("v");

    clock.advance(999);
    expect(await cache.get("k")).toBe("v");

    clock.advance(1); // now at expiresAt
    expect(await cache.get("k")).toBeUndefined();
  });

  it("evicts the least-recently-used entry beyond maxSize", async () => {
    const cache = new MemoryCache<number>({ maxSize: 2 });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3); // evicts "a"

    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBe(2);
    expect(await cache.get("c")).toBe(3);
  });

  it("get() refreshes recency so the touched key survives eviction", async () => {
    const cache = new MemoryCache<number>({ maxSize: 2 });
    await cache.set("a", 1);
    await cache.set("b", 2);

    // Touch "a" so "b" becomes the least-recently-used.
    expect(await cache.get("a")).toBe(1);

    await cache.set("c", 3); // should evict "b", not "a"
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe(1);
    expect(await cache.get("c")).toBe(3);
  });

  it("supports has/delete/clear", async () => {
    const cache = new MemoryCache<number>();
    await cache.set("a", 1);

    expect(await cache.has("a")).toBe(true);
    expect(await cache.has("nope")).toBe(false);

    expect(await cache.delete("a")).toBe(true);
    expect(await cache.delete("a")).toBe(false);
    expect(await cache.has("a")).toBe(false);

    await cache.set("x", 1);
    await cache.set("y", 2);
    await cache.clear();
    expect(await cache.has("x")).toBe(false);
    expect(await cache.has("y")).toBe(false);
  });

  it("treats an expired entry as absent for has/delete", async () => {
    const clock = makeClock();
    const cache = new MemoryCache<number>({ now: clock.now });
    await cache.set("a", 1, 100);

    clock.advance(100);
    expect(await cache.has("a")).toBe(false);
    expect(await cache.delete("a")).toBe(false);
  });
});

describe("Cache.wrap", () => {
  it("caches the loaded value and skips the loader on a hit", async () => {
    const cache = new Cache<number>();
    const loader = vi.fn(async () => 42);

    expect(await cache.wrap("k", loader)).toBe(42);
    expect(await cache.wrap("k", loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("invokes the loader exactly once under concurrent misses (single-flight)", async () => {
    const cache = new Cache<number>();
    let resolveLoader: (v: number) => void = () => {};
    const loader = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    // Fire many concurrent calls for the same missing key.
    const calls = Promise.all([
      cache.wrap("k", loader),
      cache.wrap("k", loader),
      cache.wrap("k", loader),
    ]);

    await flush(); // let all three reach the shared in-flight load
    resolveLoader(7);

    expect(await calls).toEqual([7, 7, 7]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("re-loads after the TTL expires", async () => {
    const clock = makeClock();
    const store = new MemoryCache<number>({ now: clock.now });
    const cache = new Cache<number>({ store, now: clock.now });

    let n = 0;
    const loader = vi.fn(async () => ++n);

    expect(await cache.wrap("k", loader, { ttlMs: 1_000 })).toBe(1);
    expect(await cache.wrap("k", loader, { ttlMs: 1_000 })).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);

    clock.advance(1_000); // entry now expired
    expect(await cache.wrap("k", loader, { ttlMs: 1_000 })).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("Cache.staleWhileRevalidate", () => {
  it("blocks and loads when nothing is cached", async () => {
    const cache = new Cache<string>();
    const loader = vi.fn(async () => "fresh");

    expect(await cache.staleWhileRevalidate("k", loader, { ttlMs: 1_000, staleMs: 5_000 })).toBe(
      "fresh",
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns a fresh value without touching the loader again", async () => {
    const clock = makeClock();
    const store = new MemoryCache<string>({ now: clock.now });
    const cache = new Cache<string>({ store, now: clock.now });
    const loader = vi.fn(async () => "v");

    await cache.staleWhileRevalidate("k", loader, { ttlMs: 1_000, staleMs: 5_000 });
    clock.advance(500); // still fresh
    await cache.staleWhileRevalidate("k", loader, { ttlMs: 1_000, staleMs: 5_000 });

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns the stale value immediately, then updates the cache in the background", async () => {
    const clock = makeClock();
    const store = new MemoryCache<string>({ now: clock.now });
    const cache = new Cache<string>({ store, now: clock.now });

    let value = "v1";
    const loader = vi.fn(async () => value);

    // Prime the cache.
    expect(await cache.staleWhileRevalidate("k", loader, { ttlMs: 1_000, staleMs: 5_000 })).toBe(
      "v1",
    );
    expect(loader).toHaveBeenCalledTimes(1);

    // Move into the stale window and change what the loader will return.
    clock.advance(2_000); // age 2_000: past ttl (1_000), within ttl+stale (6_000)
    value = "v2";

    // The stale value is served immediately...
    expect(await cache.staleWhileRevalidate("k", loader, { ttlMs: 1_000, staleMs: 5_000 })).toBe(
      "v1",
    );
    expect(loader).toHaveBeenCalledTimes(2); // background refresh kicked off

    // ...and the cache is updated once the background refresh settles.
    await flush();
    expect(await store.get("k")).toBe("v2");

    // A subsequent read (now fresh again) sees the refreshed value.
    expect(await cache.staleWhileRevalidate("k", loader, { ttlMs: 1_000, staleMs: 5_000 })).toBe(
      "v2",
    );
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("blocks on a fresh load once the value falls outside the stale window", async () => {
    const clock = makeClock();
    const store = new MemoryCache<string>({ now: clock.now });
    const cache = new Cache<string>({ store, now: clock.now });

    let value = "v1";
    const loader = vi.fn(async () => value);

    await cache.staleWhileRevalidate("k", loader, { ttlMs: 1_000, staleMs: 5_000 });

    clock.advance(6_000); // beyond ttl + stale → entry evicted from store
    value = "v2";
    expect(await cache.staleWhileRevalidate("k", loader, { ttlMs: 1_000, staleMs: 5_000 })).toBe(
      "v2",
    );
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
