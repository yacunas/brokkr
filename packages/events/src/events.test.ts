import { describe, expect, it, vi } from "vitest";
import { TypedEmitter } from "./emitter";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Events = {
  login: { userId: string };
  count: number;
  ping: void;
};

describe("TypedEmitter.on / emit", () => {
  it("delivers the typed payload to a registered listener", () => {
    const bus = new TypedEmitter<Events>();
    const received: string[] = [];
    bus.on("login", ({ userId }) => received.push(userId));

    const called = bus.emit("login", { userId: "u_1" });

    expect(called).toBe(true);
    expect(received).toEqual(["u_1"]);
  });

  it("delivers to multiple listeners in registration order", () => {
    const bus = new TypedEmitter<Events>();
    const order: number[] = [];
    bus.on("count", (n) => order.push(n));
    bus.on("count", (n) => order.push(n * 10));

    bus.emit("count", 2);

    expect(order).toEqual([2, 20]);
  });

  it("returns false when no listeners are registered", () => {
    const bus = new TypedEmitter<Events>();
    expect(bus.emit("ping", undefined)).toBe(false);
  });
});

describe("TypedEmitter.once", () => {
  it("fires exactly once and then stops", () => {
    const bus = new TypedEmitter<Events>();
    const listener = vi.fn();
    bus.once("count", listener);

    bus.emit("count", 1);
    bus.emit("count", 2);
    bus.emit("count", 3);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("can be unsubscribed before it ever fires", () => {
    const bus = new TypedEmitter<Events>();
    const listener = vi.fn();
    const off = bus.once("count", listener);

    off();
    bus.emit("count", 1);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("TypedEmitter.off and unsubscribe handle", () => {
  it("off stops further delivery", () => {
    const bus = new TypedEmitter<Events>();
    const listener = vi.fn();
    bus.on("count", listener);

    bus.emit("count", 1);
    bus.off("count", listener);
    bus.emit("count", 2);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("the unsubscribe function returned by on stops delivery", () => {
    const bus = new TypedEmitter<Events>();
    const listener = vi.fn();
    const off = bus.on("count", listener);

    off();
    bus.emit("count", 1);

    expect(listener).not.toHaveBeenCalled();
  });

  it("off is a no-op for an unknown listener", () => {
    const bus = new TypedEmitter<Events>();
    expect(() => bus.off("count", () => {})).not.toThrow();
  });
});

describe("TypedEmitter error isolation", () => {
  it("a throwing listener does not prevent the others and triggers onError", () => {
    const onError = vi.fn();
    const bus = new TypedEmitter<Events>({ onError });
    const after = vi.fn();
    const boom = new Error("boom");

    bus.on("ping", () => {
      throw boom;
    });
    bus.on("ping", after);

    const called = bus.emit("ping", undefined);

    expect(called).toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom, "ping");
  });

  it("swallows listener errors when no onError hook is provided", () => {
    const bus = new TypedEmitter<Events>();
    bus.on("ping", () => {
      throw new Error("boom");
    });

    expect(() => bus.emit("ping", undefined)).not.toThrow();
  });
});

describe("TypedEmitter.emitAsync", () => {
  it("awaits async listeners before resolving", async () => {
    const bus = new TypedEmitter<Events>();
    const done: number[] = [];

    bus.on("count", async (n) => {
      await delay(10);
      done.push(n);
    });
    bus.on("count", async (n) => {
      await delay(1);
      done.push(n * 10);
    });

    await bus.emitAsync("count", 1);

    expect(done).toContain(1);
    expect(done).toContain(10);
    expect(done).toHaveLength(2);
  });

  it("routes a rejecting async listener to onError without stopping the rest", async () => {
    const onError = vi.fn();
    const bus = new TypedEmitter<Events>({ onError });
    const ok = vi.fn();
    const boom = new Error("async boom");

    bus.on("ping", async () => {
      throw boom;
    });
    bus.on("ping", async () => {
      ok();
    });

    await bus.emitAsync("ping", undefined);

    expect(ok).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom, "ping");
  });

  it("resolves immediately when there are no listeners", async () => {
    const bus = new TypedEmitter<Events>();
    await expect(bus.emitAsync("ping", undefined)).resolves.toBeUndefined();
  });
});

describe("TypedEmitter.listenerCount / removeAllListeners", () => {
  it("counts registered listeners per event", () => {
    const bus = new TypedEmitter<Events>();
    const off = bus.on("count", () => {});
    bus.on("count", () => {});

    expect(bus.listenerCount("count")).toBe(2);
    expect(bus.listenerCount("ping")).toBe(0);

    off();
    expect(bus.listenerCount("count")).toBe(1);
  });

  it("removeAllListeners(event) clears one event only", () => {
    const bus = new TypedEmitter<Events>();
    bus.on("count", () => {});
    bus.on("ping", () => {});

    bus.removeAllListeners("count");

    expect(bus.listenerCount("count")).toBe(0);
    expect(bus.listenerCount("ping")).toBe(1);
  });

  it("removeAllListeners() clears every event", () => {
    const bus = new TypedEmitter<Events>();
    bus.on("count", () => {});
    bus.on("ping", () => {});

    bus.removeAllListeners();

    expect(bus.listenerCount("count")).toBe(0);
    expect(bus.listenerCount("ping")).toBe(0);
  });
});
