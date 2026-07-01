import { describe, expect, it, vi } from "vitest";
import { DataLoader } from "./dataloader";

/** Flush pending microtasks so scheduled batch dispatches run. */
async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("DataLoader batching", () => {
  it("coalesces multiple load() calls in one tick into a single batchFn call", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) => keys.map((k) => k * 2));
    const loader = new DataLoader(batchFn);

    const promises = [loader.load(1), loader.load(2), loader.load(3)];
    const values = await Promise.all(promises);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn.mock.calls[0]![0]).toEqual([1, 2, 3]);
    expect(values).toEqual([2, 4, 6]);
  });

  it("maps values back to the right keys regardless of returned ordering assumptions", async () => {
    const batchFn = vi.fn(async (keys: readonly string[]) => keys.map((k) => `value:${k}`));
    const loader = new DataLoader(batchFn);

    const [a, c, b] = await Promise.all([loader.load("a"), loader.load("c"), loader.load("b")]);

    expect(a).toBe("value:a");
    expect(b).toBe("value:b");
    expect(c).toBe("value:c");
  });

  it("dispatches separate ticks as separate batches", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) => keys.map((k) => k));
    const loader = new DataLoader(batchFn);

    const first = loader.load(1);
    await tick();
    const second = loader.load(2);
    await Promise.all([first, second]);

    expect(batchFn).toHaveBeenCalledTimes(2);
  });
});

describe("DataLoader caching", () => {
  it("returns the identical promise for repeated load(sameKey)", () => {
    const loader = new DataLoader(async (keys: readonly number[]) => keys);
    const p1 = loader.load(1);
    const p2 = loader.load(1);
    expect(p1).toBe(p2);
  });

  it("dedupes repeated keys within a single batch", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) => keys.map((k) => k * 10));
    const loader = new DataLoader(batchFn);

    const [a, b, c] = await Promise.all([loader.load(1), loader.load(1), loader.load(2)]);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn.mock.calls[0]![0]).toEqual([1, 2]);
    expect([a, b, c]).toEqual([10, 10, 20]);
  });

  it("does not cache when cache: false", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) => keys);
    const loader = new DataLoader(batchFn, { cache: false });

    await loader.load(1);
    await loader.load(1);

    expect(batchFn).toHaveBeenCalledTimes(2);
  });

  it("uses cacheKeyFn to determine identity", async () => {
    const batchFn = vi.fn(async (keys: readonly { id: number }[]) => keys.map((k) => k.id));
    const loader = new DataLoader(batchFn, { cacheKeyFn: (k) => k.id });

    const [a, b] = await Promise.all([loader.load({ id: 1 }), loader.load({ id: 1 })]);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn.mock.calls[0]![0]).toEqual([{ id: 1 }]);
    expect([a, b]).toEqual([1, 1]);
  });
});

describe("DataLoader maxBatchSize", () => {
  it("splits an oversized queue into multiple batch calls", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) => keys.map((k) => k));
    const loader = new DataLoader(batchFn, { maxBatchSize: 2 });

    const values = await Promise.all([1, 2, 3, 4, 5].map((k) => loader.load(k)));

    expect(batchFn).toHaveBeenCalledTimes(3);
    expect(batchFn.mock.calls[0]![0]).toEqual([1, 2]);
    expect(batchFn.mock.calls[1]![0]).toEqual([3, 4]);
    expect(batchFn.mock.calls[2]![0]).toEqual([5]);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects a non-positive maxBatchSize", () => {
    expect(() => new DataLoader(async (k: readonly number[]) => k, { maxBatchSize: 0 })).toThrow(
      TypeError,
    );
  });
});

describe("DataLoader per-key errors", () => {
  it("rejects only the erroring key while siblings resolve", async () => {
    const boom = new Error("no 2");
    const loader = new DataLoader(async (keys: readonly number[]) =>
      keys.map((k) => (k === 2 ? boom : k * 3)),
    );

    const p1 = loader.load(1);
    const p2 = loader.load(2);
    const p3 = loader.load(3);

    await expect(p1).resolves.toBe(3);
    await expect(p2).rejects.toBe(boom);
    await expect(p3).resolves.toBe(9);
  });

  it("does not cache a failed key — a later load retries", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) =>
      keys.map((k) => (k === 1 ? new Error("fail") : k)),
    );
    const loader = new DataLoader(batchFn);

    await expect(loader.load(1)).rejects.toThrow("fail");

    // Second attempt in a new tick must call the batch function again.
    await expect(loader.load(1)).rejects.toThrow("fail");
    expect(batchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects every key when the batch function itself throws", async () => {
    const loader = new DataLoader(async () => {
      throw new Error("db down");
    });

    const p1 = loader.load(1);
    const p2 = loader.load(2);

    await expect(p1).rejects.toThrow("db down");
    await expect(p2).rejects.toThrow("db down");
  });

  it("rejects with a clear error when the result length mismatches the keys", async () => {
    const loader = new DataLoader(async () => [1] as number[]);

    const p1 = loader.load(1);
    const p2 = loader.load(2);

    await expect(p1).rejects.toThrow(/length 1.*2 keys were requested/s);
    await expect(p2).rejects.toThrow(/align by index/);
  });
});

describe("DataLoader loadMany", () => {
  it("returns values and Errors without rejecting", async () => {
    const boom = new Error("bad");
    const loader = new DataLoader(async (keys: readonly number[]) =>
      keys.map((k) => (k === 2 ? boom : k)),
    );

    const results = await loader.loadMany([1, 2, 3]);

    expect(results[0]).toBe(1);
    expect(results[1]).toBe(boom);
    expect(results[2]).toBe(3);
  });

  it("batches all keys of a loadMany into one call", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) => keys);
    const loader = new DataLoader(batchFn);

    await loader.loadMany([1, 2, 3]);

    expect(batchFn).toHaveBeenCalledTimes(1);
  });
});

describe("DataLoader cache management", () => {
  it("prime serves a value without a batch call", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) => keys);
    const loader = new DataLoader(batchFn);

    loader.prime(1, 100);
    await expect(loader.load(1)).resolves.toBe(100);
    expect(batchFn).not.toHaveBeenCalled();
  });

  it("prime does not overwrite an existing entry", async () => {
    const loader = new DataLoader(async (keys: readonly number[]) => keys.map((k) => k));
    loader.prime(1, 100);
    loader.prime(1, 999);
    await expect(loader.load(1)).resolves.toBe(100);
  });

  it("clear evicts a single key so the next load re-batches", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) => keys);
    const loader = new DataLoader(batchFn);

    await loader.load(1);
    loader.clear(1);
    await loader.load(1);

    expect(batchFn).toHaveBeenCalledTimes(2);
  });

  it("clearAll empties the cache", async () => {
    const batchFn = vi.fn(async (keys: readonly number[]) => keys);
    const loader = new DataLoader(batchFn);

    await Promise.all([loader.load(1), loader.load(2)]);
    loader.clearAll();
    await Promise.all([loader.load(1), loader.load(2)]);

    expect(batchFn).toHaveBeenCalledTimes(2);
  });
});

describe("DataLoader custom schedule", () => {
  it("honours a custom scheduler for the batch window", async () => {
    const scheduled: Array<() => void> = [];
    const batchFn = vi.fn(async (keys: readonly number[]) => keys);
    const loader = new DataLoader(batchFn, {
      schedule: (cb) => {
        scheduled.push(cb);
      },
    });

    const p = loader.load(1);
    loader.load(2);

    // Nothing dispatched until we manually run the scheduled callback.
    expect(batchFn).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    scheduled[0]!();
    await p;

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn.mock.calls[0]![0]).toEqual([1, 2]);
  });
});
