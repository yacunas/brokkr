import { describe, expect, it } from "vitest";
import { Logger, type LogRecord } from "./logger";

/** Build a logger wired to an array sink, returning both for assertions. */
function withSink(options: Omit<ConstructorParameters<typeof Logger>[0], "sink"> = {}) {
  const records: LogRecord[] = [];
  const logger = new Logger({ ...options, sink: (record) => records.push(record) });
  return { logger, records };
}

describe("level filtering", () => {
  it("drops records below the configured minimum level", () => {
    const { logger, records } = withSink({ level: "info" });
    logger.debug("noisy");
    expect(records).toHaveLength(0);
  });

  it("keeps records at or above the configured minimum level", () => {
    const { logger, records } = withSink({ level: "info" });
    logger.info("kept");
    logger.warn("also kept");
    expect(records.map((r) => r.level)).toEqual(["info", "warn"]);
  });

  it("emits every level when the minimum is trace", () => {
    const { logger, records } = withSink({ level: "trace" });
    logger.trace("t");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(records).toHaveLength(5);
  });
});

describe("record shape", () => {
  it("carries message, level, time, and fields", () => {
    const { logger, records } = withSink({ level: "info", now: () => 1000 });
    logger.info("hello", { user: "ada" });
    expect(records[0]).toEqual({
      level: "info",
      message: "hello",
      time: 1000,
      fields: { user: "ada" },
    });
  });

  it("defaults fields to an empty object when none are supplied", () => {
    const { logger, records } = withSink({ level: "info" });
    logger.info("bare");
    expect(records[0]?.fields).toEqual({});
  });
});

describe("child bindings", () => {
  it("merges object bindings into every record", () => {
    const { logger, records } = withSink({ level: "info" });
    const child = logger.child({ requestId: "abc" });
    child.info("handled", { status: 200 });
    expect(records[0]?.fields).toEqual({ requestId: "abc", status: 200 });
  });

  it("does not mutate the parent", () => {
    const { logger, records } = withSink({ level: "info" });
    const child = logger.child({ requestId: "abc" });
    logger.info("parent");
    child.info("child");
    expect(records[0]?.fields).toEqual({});
    expect(records[1]?.fields).toEqual({ requestId: "abc" });
  });

  it("treats a string argument as a context binding", () => {
    const { logger, records } = withSink({ level: "info" });
    logger.child("http").info("req");
    expect(records[0]?.fields).toEqual({ context: ["http"] });
  });

  it("composes nested string contexts into an array", () => {
    const { logger, records } = withSink({ level: "info" });
    logger.child("http").child("auth").info("check");
    expect(records[0]?.fields).toEqual({ context: ["http", "auth"] });
  });

  it("composes nested object children", () => {
    const { logger, records } = withSink({ level: "info" });
    logger.child({ a: 1 }).child({ b: 2 }).info("merged", { c: 3 });
    expect(records[0]?.fields).toEqual({ a: 1, b: 2, c: 3 });
  });
});

describe("redaction", () => {
  it("replaces configured top-level keys with [REDACTED]", () => {
    const { logger, records } = withSink({ level: "info", redact: ["password", "token"] });
    logger.info("login", { user: "ada", password: "hunter2", token: "xyz" });
    expect(records[0]?.fields).toEqual({
      user: "ada",
      password: "[REDACTED]",
      token: "[REDACTED]",
    });
  });

  it("replaces matching keys at any nesting depth", () => {
    const { logger, records } = withSink({ level: "info", redact: ["password"] });
    logger.info("nested", { auth: { password: "secret", ok: true } });
    expect(records[0]?.fields).toEqual({ auth: { password: "[REDACTED]", ok: true } });
  });

  it("supports dotted paths for a specific nested value", () => {
    const { logger, records } = withSink({ level: "info", redact: ["user.ssn"] });
    logger.info("pii", { user: { ssn: "123", name: "ada" }, ssn: "keep" });
    expect(records[0]?.fields).toEqual({
      user: { ssn: "[REDACTED]", name: "ada" },
      ssn: "keep",
    });
  });
});

describe("error serialization", () => {
  it("serializes an Error field to name/message/stack", () => {
    const { logger, records } = withSink({ level: "info" });
    const err = new TypeError("boom");
    logger.error("failed", { error: err });
    const serialized = records[0]?.fields["error"] as {
      name: string;
      message: string;
      stack?: string;
    };
    expect(serialized.name).toBe("TypeError");
    expect(serialized.message).toBe("boom");
    expect(serialized.stack).toBe(err.stack);
  });
});

describe("injectable clock", () => {
  it("uses the injected now() for the record time", () => {
    let tick = 0;
    const { logger, records } = withSink({ level: "info", now: () => (tick += 5) });
    logger.info("first");
    logger.info("second");
    expect(records.map((r) => r.time)).toEqual([5, 10]);
  });
});
