/**
 * Structured, typed, testable logging with zero runtime dependencies.
 *
 * A {@link Logger} produces a plain {@link LogRecord} for every call and hands
 * it to a {@link Sink}. Records are filtered by an ordered minimum {@link Level},
 * enriched with immutable child {@link bindings}, redacted by configured key, and
 * have any `fields.error` serialized to a plain `{ name, message, stack }` shape.
 */

/** Severity levels, ordered from least to most severe. */
export const LEVELS = ["trace", "debug", "info", "warn", "error"] as const;

/** A single severity level. */
export type Level = (typeof LEVELS)[number];

/** Numeric severity for each {@link Level}; higher is more severe. */
const LEVEL_WEIGHT: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/** An arbitrary bag of structured fields attached to a log record. */
export type Fields = Record<string, unknown>;

/**
 * The structured payload produced for every log call and handed to a {@link Sink}.
 * This is the stable contract transports should depend on.
 */
export interface LogRecord {
  /** Severity of this record. */
  level: Level;
  /** Human-readable message. */
  message: string;
  /** Epoch milliseconds when the record was produced (from the injectable clock). */
  time: number;
  /** Merged child bindings + per-call fields, after redaction and Error serialization. */
  fields: Fields;
}

/** A transport: receives fully-formed, redacted records. Must not throw. */
export type Sink = (record: LogRecord) => void;

/** Options accepted by the {@link Logger} constructor. */
export interface LoggerOptions {
  /** Minimum level to emit; anything less severe is dropped. Default `"info"`. */
  level?: Level;
  /** Where records are written. Default: JSON lines to stdout. */
  sink?: Sink;
  /**
   * Field keys whose values are replaced with `"[REDACTED]"` before the record
   * reaches the sink. Matches top-level keys and nested keys by name; dotted
   * paths (e.g. `"user.password"`) match a specific top-level path.
   */
  redact?: string[];
  /** Injectable clock, in epoch milliseconds. Default {@link Date.now}. */
  now?: () => number;
  /** Bindings merged into every record. Used internally by {@link Logger.child}. */
  bindings?: Fields;
}

/** Placeholder substituted for redacted values. */
const REDACTED = "[REDACTED]";

/** Default sink: one JSON object per line to stdout. */
const defaultSink: Sink = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

/** Serialize an {@link Error} to a plain, JSON-friendly shape. */
function serializeError(error: Error): { name: string; message: string; stack?: string } {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

/** True for a plain object we should recurse into (not arrays, not `null`). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A structured logger. Immutable: {@link child} returns a new instance rather
 * than mutating the parent, so bindings never leak sideways.
 *
 * @example
 * ```ts
 * const log = new Logger({ level: "info", redact: ["password"] });
 * const http = log.child("http");        // adds { context: ["http"] }
 * http.info("request", { method: "GET" });
 * ```
 */
export class Logger {
  private readonly level: Level;
  private readonly sink: Sink;
  private readonly redactKeys: readonly string[];
  private readonly nowFn: () => number;
  private readonly bindings: Fields;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.sink = options.sink ?? defaultSink;
    this.redactKeys = options.redact ?? [];
    this.nowFn = options.now ?? Date.now;
    this.bindings = options.bindings ?? {};
  }

  /** Log at `trace` severity. */
  trace(message: string, fields?: Fields): void {
    this.log("trace", message, fields);
  }

  /** Log at `debug` severity. */
  debug(message: string, fields?: Fields): void {
    this.log("debug", message, fields);
  }

  /** Log at `info` severity. */
  info(message: string, fields?: Fields): void {
    this.log("info", message, fields);
  }

  /** Log at `warn` severity. */
  warn(message: string, fields?: Fields): void {
    this.log("warn", message, fields);
  }

  /** Log at `error` severity. */
  error(message: string, fields?: Fields): void {
    this.log("error", message, fields);
  }

  /**
   * Create a child logger that merges additional bindings into every record.
   * The parent is left untouched (immutable).
   *
   * - `child({ requestId })` merges the given fields.
   * - `child("http")` appends `"http"` to a `context` array binding, so nested
   *   children compose into `{ context: ["http", "auth"] }`.
   */
  child(bindings: Fields | string): Logger {
    const merged = mergeBindings(this.bindings, bindings);
    return new Logger({
      level: this.level,
      sink: this.sink,
      redact: [...this.redactKeys],
      now: this.nowFn,
      bindings: merged,
    });
  }

  /** True if `level` is severe enough to emit given the configured minimum. */
  isLevelEnabled(level: Level): boolean {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.level];
  }

  /** Build a record (if the level passes the filter) and hand it to the sink. */
  private log(level: Level, message: string, fields?: Fields): void {
    if (!this.isLevelEnabled(level)) return;

    const combined: Fields = { ...this.bindings, ...(fields ?? {}) };
    const prepared = redact(serializeErrors(combined), this.redactKeys);

    this.sink({
      level,
      message,
      time: this.nowFn(),
      fields: prepared,
    });
  }
}

/** Merge a parent's bindings with the child's, handling the string-context form. */
function mergeBindings(parent: Fields, next: Fields | string): Fields {
  if (typeof next === "string") {
    const existing = parent["context"];
    const context = Array.isArray(existing) ? [...existing, next] : [next];
    return { ...parent, context };
  }
  return { ...parent, ...next };
}

/** Recursively replace any `Error` values with a serialized plain object. */
function serializeErrors(value: Fields): Fields {
  const out: Fields = {};
  for (const [key, val] of Object.entries(value)) {
    if (val instanceof Error) {
      out[key] = serializeError(val);
    } else if (isPlainObject(val)) {
      out[key] = serializeErrors(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Return a deep copy of `fields` with redacted keys replaced by `"[REDACTED]"`.
 *
 * A redact entry matches when it equals a key at any depth, or when it is a
 * dotted path (`"a.b"`) that resolves from the top level. The input is never
 * mutated.
 */
function redact(fields: Fields, keys: readonly string[]): Fields {
  if (keys.length === 0) return fields;

  const nameSet = new Set<string>();
  const paths: string[][] = [];
  for (const key of keys) {
    if (key.includes(".")) {
      paths.push(key.split("."));
    } else {
      nameSet.add(key);
    }
  }

  const walk = (input: Fields): Fields => {
    const out: Fields = {};
    for (const [key, val] of Object.entries(input)) {
      if (nameSet.has(key)) {
        out[key] = REDACTED;
      } else if (isPlainObject(val)) {
        out[key] = walk(val);
      } else {
        out[key] = val;
      }
    }
    return out;
  };

  const result = walk(fields);
  for (const path of paths) {
    redactPath(result, path);
  }
  return result;
}

/** Replace the value at a dotted path with `"[REDACTED]"` if it exists. */
function redactPath(target: Fields, path: string[]): void {
  let cursor: Fields = target;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    if (segment === undefined) return;
    const nextNode = cursor[segment];
    if (!isPlainObject(nextNode)) return;
    cursor = nextNode;
  }
  const last = path[path.length - 1];
  if (last !== undefined && last in cursor) {
    cursor[last] = REDACTED;
  }
}
