import { describe, expect, it } from "vitest";
import { mapLimit, pool, settleLimit } from "./concurrency";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("pool", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    const p = pool(2);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred<void>());

    const tasks = gates.map((gate, i) =>
      p.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
        return i;
      }),
    );

    await delay(10); // let the first batch start and block
    expect(p.active).toBe(2);
    expect(p.queued).toBe(3);

    gates.forEach((gate) => gate.resolve());
    const results = await Promise.all(tasks);

    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it("propagates a task rejection and stays usable", async () => {
    const p = pool(1);
    await expect(p.run(async () => Promise.reject(new Error("nope")))).rejects.toThrow("nope");
    expect(await p.run(async () => 42)).toBe(42);
  });

  it("onIdle resolves only once fully drained", async () => {
    const p = pool(2);
    let idle = false;
    p.run(() => delay(5));
    p.run(() => delay(5));
    p.run(() => delay(5));
    const waiting = p.onIdle().then(() => {
      idle = true;
    });
    expect(idle).toBe(false);
    await waiting;
    expect(p.active).toBe(0);
    expect(p.queued).toBe(0);
  });

  it("rejects an invalid concurrency", () => {
    expect(() => pool(0)).toThrow(RangeError);
    expect(() => pool(-1)).toThrow(RangeError);
    expect(() => pool(1.5)).toThrow(RangeError);
  });
});

describe("mapLimit", () => {
  it("preserves input order despite varying task durations", async () => {
    const out = await mapLimit([10, 20, 30, 40], 2, async (n, i) => {
      await delay(i % 2 === 0 ? 8 : 1); // out-of-order completion
      return n * 2;
    });
    expect(out).toEqual([20, 40, 60, 80]);
  });

  it("rejects on the first failing task", async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});

describe("settleLimit", () => {
  it("never rejects and returns settled results in order", async () => {
    const out = await settleLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(out[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(out[1]?.status).toBe("rejected");
    expect(out[2]).toEqual({ status: "fulfilled", value: 3 });
  });
});
