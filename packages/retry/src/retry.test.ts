import { afterEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker, computeBackoff, retry, withTimeout, type Sleep } from "./retry";
import { CircuitOpenError, TimeoutError } from "./errors";

/** A `sleep` that resolves instantly while recording every requested delay. */
function recordingSleep(): { sleep: Sleep; delays: number[] } {
  const delays: number[] = [];
  const sleep: Sleep = (ms) => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { sleep, delays };
}

describe("retry", () => {
  it("succeeds on the first try without sleeping", async () => {
    const { sleep, delays } = recordingSleep();
    const fn = vi.fn(async () => "ok");

    await expect(retry(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
    expect(delays).toEqual([]);
  });

  it("succeeds after N transient failures", async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return "recovered";
    });

    await expect(retry(fn, { attempts: 5, sleep })).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("exhausts attempts and throws the last error", async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      throw new Error(`fail ${calls}`);
    });

    await expect(retry(fn, { attempts: 3, sleep })).rejects.toThrow("fail 3");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops immediately when shouldRetry returns false", async () => {
    const { sleep, delays } = recordingSleep();
    const fn = vi.fn(async () => {
      throw new Error("fatal");
    });

    await expect(retry(fn, { attempts: 5, sleep, shouldRetry: () => false })).rejects.toThrow(
      "fatal",
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("passes the error, attempt and delay to shouldRetry and onRetry", async () => {
    const { sleep } = recordingSleep();
    const shouldRetry = vi.fn(() => true);
    const onRetry = vi.fn();
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 2) throw new Error("boom");
      return "ok";
    };

    await retry(fn, {
      attempts: 3,
      minDelayMs: 100,
      factor: 2,
      jitter: false,
      sleep,
      shouldRetry,
      onRetry,
    });

    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error), 1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 100);
  });

  it("backoff delays follow min(max, min * factor**(attempt-1)) with jitter disabled", async () => {
    const { sleep, delays } = recordingSleep();
    const fn = async () => {
      throw new Error("always");
    };

    await expect(
      retry(fn, {
        attempts: 5,
        minDelayMs: 100,
        maxDelayMs: 1_000,
        factor: 2,
        jitter: false,
        sleep,
      }),
    ).rejects.toThrow("always");

    // attempts 1..4 sleep (attempt 5 is the last, no sleep):
    // 100, 200, 400, min(1000, 800)=800
    expect(delays).toEqual([100, 200, 400, 800]);
  });

  it("rejects promptly when the signal is already aborted", async () => {
    const { sleep } = recordingSleep();
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => "unreached");

    await expect(retry(fn, { sleep, signal: controller.signal })).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects when the signal aborts between attempts", async () => {
    const controller = new AbortController();
    // Abort during the backoff sleep of the first failure.
    const sleep: Sleep = () => {
      controller.abort(new Error("cancelled"));
      return Promise.resolve();
    };
    const fn = vi.fn(async () => {
      throw new Error("fail");
    });

    await expect(retry(fn, { attempts: 5, sleep, signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("computeBackoff", () => {
  it("caps at maxDelayMs", () => {
    expect(
      computeBackoff(10, { minDelayMs: 100, maxDelayMs: 1_000, factor: 2, jitter: false }),
    ).toBe(1_000);
  });

  it("applies full jitter as random() * base", () => {
    const value = computeBackoff(3, {
      minDelayMs: 100,
      maxDelayMs: 10_000,
      factor: 2,
      jitter: true,
      random: () => 0.5,
    });
    // base = 100 * 2**2 = 400, jittered = 0.5 * 400
    expect(value).toBe(200);
  });
});

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve("fast"), 1_000)).resolves.toBe("fast");
  });

  it("accepts a thunk and resolves its result", async () => {
    await expect(withTimeout(() => Promise.resolve(42), 1_000)).resolves.toBe(42);
  });

  it("rejects with TimeoutError when the deadline elapses", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const promise = withTimeout(never, 5_000);
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it("propagates the underlying rejection unchanged", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1_000)).rejects.toThrow("boom");
  });
});

describe("CircuitBreaker", () => {
  it("stays closed and passes through successes", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1_000 });
    await expect(breaker.run(async () => "ok")).resolves.toBe("ok");
    expect(breaker.state).toBe("closed");
  });

  it("opens after the failure threshold is reached", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 1_000,
      now: () => now,
    });
    const boom = async () => {
      throw new Error("boom");
    };

    await expect(breaker.run(boom)).rejects.toThrow("boom");
    expect(breaker.state).toBe("closed");
    await expect(breaker.run(boom)).rejects.toThrow("boom");
    expect(breaker.state).toBe("open");
  });

  it("rejects fast with CircuitOpenError while open", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      now: () => now,
    });
    await expect(
      breaker.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(breaker.state).toBe("open");

    const fn = vi.fn(async () => "unreached");
    now = 500; // still within reset window
    await expect(breaker.run(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("half-opens after the reset timeout and closes on a successful trial", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      now: () => now,
    });
    await expect(
      breaker.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(breaker.state).toBe("open");

    now = 1_000; // reset elapsed
    expect(breaker.state).toBe("half-open");
    await expect(breaker.run(async () => "recovered")).resolves.toBe("recovered");
    expect(breaker.state).toBe("closed");
  });

  it("re-opens when the half-open trial fails and restarts the timer", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      now: () => now,
    });
    const boom = async () => {
      throw new Error("boom");
    };

    await expect(breaker.run(boom)).rejects.toThrow("boom");
    now = 1_000; // half-open trial allowed
    await expect(breaker.run(boom)).rejects.toThrow("boom");
    expect(breaker.state).toBe("open");

    // Timer restarted at now=1000, so at 1500 it is still open.
    now = 1_500;
    await expect(breaker.run(async () => "x")).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
