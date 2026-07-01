# @brokkr/logger

Structured, typed, testable logging for TypeScript backends. Zero dependencies.

Every call produces a plain `LogRecord` and hands it to a `sink`. Levels are
ordered and filtered by a minimum, child loggers merge immutable bindings,
configured field keys are redacted, and `Error` values are serialized — so your
logs are structured data, not string soup.

## Install

```sh
pnpm add @brokkr/logger
```

## Quick start

```ts
import { Logger } from "@brokkr/logger";

const log = new Logger({ level: "info", redact: ["password", "token"] });

log.info("server started", { port: 3000 });
// {"level":"info","message":"server started","time":1719800000000,"fields":{"port":3000}}
```

## Levels

Ordered from least to most severe:

```
trace < debug < info < warn < error
```

The `level` option sets the minimum; anything less severe is dropped.

```ts
const log = new Logger({ level: "info" });
log.debug("skipped"); // filtered out
log.warn("kept"); // emitted
```

## Child loggers

`child()` returns a new logger that merges bindings into every record. The
parent is never mutated.

```ts
const log = new Logger();

// Object bindings
const reqLog = log.child({ requestId: "abc" });
reqLog.info("handled", { status: 200 });
// fields: { requestId: "abc", status: 200 }

// String context — appends to a `context` array, so nested children compose
log.child("http").child("auth").info("check");
// fields: { context: ["http", "auth"] }
```

## Redaction

Field keys listed in `redact` are replaced with `"[REDACTED]"` before the record
reaches the sink. Matches keys at any depth; dotted paths target a specific
top-level path.

```ts
const log = new Logger({ redact: ["password", "user.ssn"] });
log.info("login", { user: { ssn: "123" }, password: "hunter2" });
// fields: { user: { ssn: "[REDACTED]" }, password: "[REDACTED]" }
```

## Error serialization

An `Error` passed on any field is serialized to `{ name, message, stack }`.

```ts
log.error("request failed", { error: new TypeError("boom") });
// fields.error: { name: "TypeError", message: "boom", stack: "…" }
```

## Custom sink

The default sink writes JSON lines to stdout. Inject your own transport — tests
typically push to an array.

```ts
const records: LogRecord[] = [];
const log = new Logger({ sink: (record) => records.push(record) });
```

## Injectable clock

Pass `now` to control `record.time` (defaults to `Date.now`). Handy for
deterministic tests.

```ts
const log = new Logger({ now: () => 1000 });
```

## API

- `new Logger(options?)` — `{ level?, sink?, redact?, now?, bindings? }`
- `logger.trace/debug/info/warn/error(message, fields?)`
- `logger.child(bindings | context)` → `Logger`
- `logger.isLevelEnabled(level)` → `boolean`
- `LogRecord` — `{ level, message, time, fields }`

## License

MIT © Yronnel James
