import { describe, expect, it } from "vitest";

import {
  all,
  andThen,
  err,
  fromPromise,
  fromThrowable,
  isErr,
  isOk,
  map,
  mapErr,
  match,
  ok,
  unwrap,
  unwrapOr,
  type Result,
} from "./index.js";

describe("construction and guards", () => {
  it("ok wraps a value", () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("err wraps an error", () => {
    const error = new Error("boom");
    const result = err(error);
    expect(result).toEqual({ ok: false, error });
  });

  it("isOk narrows to Ok and isErr is its inverse", () => {
    const good: Result<number, string> = ok(1);
    const bad: Result<number, string> = err("nope");

    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);

    if (isOk(good)) {
      expect(good.value).toBe(1);
    }
    if (isErr(bad)) {
      expect(bad.error).toBe("nope");
    }
  });
});

describe("map / mapErr", () => {
  it("map transforms an Ok value", () => {
    expect(map(ok(2), (n) => n * 10)).toEqual(ok(20));
  });

  it("map leaves an Err untouched", () => {
    const input: Result<number, string> = err("bad");
    expect(map(input, (n) => n * 10)).toEqual(err("bad"));
  });

  it("mapErr transforms an Err error", () => {
    expect(mapErr(err("boom"), (m) => m.toUpperCase())).toEqual(err("BOOM"));
  });

  it("mapErr leaves an Ok untouched", () => {
    // `as` keeps the static type a union (a bare annotation narrows to Ok<number>).
    const input = ok(5) as Result<number, string>;
    expect(mapErr(input, (m) => m.toUpperCase())).toEqual(ok(5));
  });
});

describe("andThen chaining", () => {
  const half = (n: number): Result<number, string> => (n % 2 === 0 ? ok(n / 2) : err("odd"));

  it("chains successful Results", () => {
    expect(andThen(ok(8), half)).toEqual(ok(4));
  });

  it("propagates an Err produced by fn", () => {
    expect(andThen(ok(7), half)).toEqual(err("odd"));
  });

  it("short-circuits on an incoming Err without calling fn", () => {
    let called = false;
    const input: Result<number, string> = err("upstream");
    const out = andThen(input, (n) => {
      called = true;
      return half(n);
    });
    expect(out).toEqual(err("upstream"));
    expect(called).toBe(false);
  });

  it("composes across multiple steps", () => {
    const out = andThen(andThen(ok(16), half), half);
    expect(out).toEqual(ok(4));
  });
});

describe("unwrap / unwrapOr", () => {
  it("unwrap returns the value for Ok", () => {
    expect(unwrap(ok("hi"))).toBe("hi");
  });

  it("unwrap throws the contained error for Err", () => {
    const error = new Error("nope");
    expect(() => unwrap(err(error))).toThrow(error);
  });

  it("unwrapOr returns the value for Ok", () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
  });

  it("unwrapOr returns the fallback for Err", () => {
    const input: Result<number, string> = err("x");
    expect(unwrapOr(input, 0)).toBe(0);
  });
});

describe("match", () => {
  it("runs the ok branch for Ok", () => {
    const label = match(ok(3), {
      ok: (n) => `got ${n}`,
      err: (e: string) => `failed: ${e}`,
    });
    expect(label).toBe("got 3");
  });

  it("runs the err branch for Err", () => {
    const label = match(err("bad"), {
      ok: (n: number) => `got ${n}`,
      err: (e) => `failed: ${e}`,
    });
    expect(label).toBe("failed: bad");
  });
});

describe("fromThrowable", () => {
  it("captures a return value as Ok", () => {
    expect(fromThrowable(() => 21 * 2)).toEqual(ok(42));
  });

  it("captures a thrown Error as Err", () => {
    const result = fromThrowable(() => {
      throw new Error("boom");
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe("boom");
    }
  });

  it("wraps a non-Error throw in an Error", () => {
    const result = fromThrowable(() => {
      throw "plain string";
    });
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe("plain string");
    }
  });
});

describe("fromPromise", () => {
  it("captures a resolved value as Ok", async () => {
    const result = await fromPromise(Promise.resolve(7));
    expect(result).toEqual(ok(7));
  });

  it("captures a rejection as Err without throwing", async () => {
    const error = new Error("rejected");
    const result = await fromPromise(Promise.reject(error));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe(error);
    }
  });

  it("wraps a non-Error rejection in an Error", async () => {
    const result = await fromPromise(Promise.reject("nope"));
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe("nope");
    }
  });
});

describe("all", () => {
  it("collects every value when all are Ok", () => {
    expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
  });

  it("returns an Ok of an empty array for no results", () => {
    expect(all([])).toEqual(ok([]));
  });

  it("returns the first Err and short-circuits", () => {
    const results: Result<number, string>[] = [ok(1), err("first"), err("second")];
    expect(all(results)).toEqual(err("first"));
  });
});
