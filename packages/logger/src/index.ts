/**
 * @brokkr/logger
 *
 * Structured, typed, testable logging for TypeScript backends, zero dependencies:
 *
 * - **Ordered levels** — `trace < debug < info < warn < error`, with a
 *   configurable minimum {@link Level} that filters output.
 * - **Immutable children** — {@link Logger.child} merges bindings (or a string
 *   `context`) into every record without mutating the parent.
 * - **Redaction** — configured field keys are replaced with `"[REDACTED]"`
 *   before records reach the sink.
 * - **Pluggable sink** — every call produces a {@link LogRecord} handed to a
 *   {@link Sink}; the default writes JSON lines to stdout, tests inject an array.
 */

export { Logger, LEVELS } from "./logger";
export type { Level, Fields, LogRecord, Sink, LoggerOptions } from "./logger";
