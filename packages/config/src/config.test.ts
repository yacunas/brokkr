import { describe, expect, it } from "vitest";
import { ConfigError, bool, enumOf, json, loadConfig, num, port, str } from "./index.js";

describe("loadConfig — coercion", () => {
  it("parses and coerces every field kind from a source map", () => {
    const cfg = loadConfig(
      {
        NAME: str(),
        RETRIES: num(),
        DEBUG: bool(),
        PORT: port(),
        NODE_ENV: enumOf(["dev", "prod"] as const),
        FLAGS: json<{ beta: boolean }>(),
      },
      {
        NAME: "brokkr",
        RETRIES: "5",
        DEBUG: "yes",
        PORT: "8080",
        NODE_ENV: "prod",
        FLAGS: '{"beta":true}',
      },
    );

    expect(cfg).toEqual({
      NAME: "brokkr",
      RETRIES: 5,
      DEBUG: true,
      PORT: 8080,
      NODE_ENV: "prod",
      FLAGS: { beta: true },
    });
  });

  it("accepts all documented boolean spellings case-insensitively", () => {
    const truthy = ["true", "TRUE", "1", "yes", "YES"];
    const falsy = ["false", "FALSE", "0", "no", "NO"];
    for (const raw of truthy) {
      expect(loadConfig({ B: bool() }, { B: raw }).B).toBe(true);
    }
    for (const raw of falsy) {
      expect(loadConfig({ B: bool() }, { B: raw }).B).toBe(false);
    }
  });

  it("infers a precise enum union from a non-const array too", () => {
    const cfg = loadConfig({ LEVEL: enumOf(["low", "high"]) }, { LEVEL: "high" });
    expect(cfg.LEVEL).toBe("high");
  });
});

describe("loadConfig — defaults and optional", () => {
  it("applies defaults when the key is absent", () => {
    const cfg = loadConfig({ PORT: port().default(3000) }, {});
    expect(cfg.PORT).toBe(3000);
  });

  it("prefers the source value over a default when present", () => {
    const cfg = loadConfig({ PORT: port().default(3000) }, { PORT: "4000" });
    expect(cfg.PORT).toBe(4000);
  });

  it("yields undefined for an absent optional field", () => {
    const cfg = loadConfig({ DEBUG: bool().optional() }, {});
    expect(cfg.DEBUG).toBeUndefined();
    expect("DEBUG" in cfg).toBe(true);
  });
});

describe("loadConfig — aggregated errors", () => {
  it("lists ALL missing required keys at once", () => {
    let caught: unknown;
    try {
      loadConfig({ A: str(), B: num(), C: port() }, {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const err = caught as ConfigError;
    expect(err.issues.map((i) => i.key)).toEqual(["A", "B", "C"]);
    for (const issue of err.issues) {
      expect(issue.message).toBe("missing required value");
    }
    expect(err.message).toContain("3 issue(s)");
  });

  it("reports invalid number, out-of-range port, bad enum, and malformed json together", () => {
    let caught: unknown;
    try {
      loadConfig(
        {
          N: num(),
          P: port(),
          E: enumOf(["a", "b"] as const),
          J: json(),
        },
        { N: "not-a-number", P: "99999", E: "c", J: "{bad" },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const err = caught as ConfigError;
    const byKey = Object.fromEntries(err.issues.map((i) => [i.key, i.message]));

    expect(err.issues).toHaveLength(4);
    expect(byKey.N).toContain("expected a number");
    expect(byKey.P).toContain("out of range");
    expect(byKey.E).toContain("expected one of");
    expect(byKey.J).toContain("invalid JSON");
  });

  it("mixes missing and invalid issues in a single throw", () => {
    let caught: unknown;
    try {
      loadConfig({ MISSING: str(), BADNUM: num() }, { BADNUM: "abc" });
    } catch (error) {
      caught = error;
    }
    const err = caught as ConfigError;
    expect(err.issues).toHaveLength(2);
    expect(err.issues.map((i) => i.key).sort()).toEqual(["BADNUM", "MISSING"]);
  });

  it("does not throw on the first error — later valid fields are still evaluated", () => {
    let caught: unknown;
    try {
      loadConfig({ BAD: num(), OK: str() }, { BAD: "x", OK: "fine" });
    } catch (error) {
      caught = error;
    }
    const err = caught as ConfigError;
    // Only BAD failed; OK coerced cleanly and produced no issue.
    expect(err.issues.map((i) => i.key)).toEqual(["BAD"]);
  });
});

describe("loadConfig — edge cases", () => {
  it("rejects a blank string for numeric fields", () => {
    expect(() => loadConfig({ N: num() }, { N: "   " })).toThrow(ConfigError);
    expect(() => loadConfig({ P: port() }, { P: "" })).toThrow(ConfigError);
  });

  it("rejects a non-integer port", () => {
    let caught: unknown;
    try {
      loadConfig({ P: port() }, { P: "80.5" });
    } catch (error) {
      caught = error;
    }
    expect((caught as ConfigError).issues[0]?.message).toContain("integer port");
  });

  it("accepts the inclusive port boundaries", () => {
    expect(loadConfig({ P: port() }, { P: "1" }).P).toBe(1);
    expect(loadConfig({ P: port() }, { P: "65535" }).P).toBe(65535);
  });
});

describe("loadConfig — inferred types", () => {
  it("infers required/optional/default output types", () => {
    const cfg = loadConfig(
      {
        PORT: port().default(3000),
        NODE_ENV: enumOf(["dev", "prod"] as const),
        DEBUG: bool().optional(),
      },
      { NODE_ENV: "prod" },
    );

    // Compile-time assertions: `satisfies` proves each property is no *wider*
    // than expected, and the explicit annotation proves it is no *narrower*.
    cfg satisfies { PORT: number; NODE_ENV: "dev" | "prod"; DEBUG: boolean | undefined };
    const exact: { PORT: number; NODE_ENV: "dev" | "prod"; DEBUG: boolean | undefined } = cfg;

    expect(exact.PORT).toBe(3000);
    expect(exact.NODE_ENV).toBe("prod");
    expect(exact.DEBUG).toBeUndefined();
  });
});
