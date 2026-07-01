# @brokkr/config

Typed environment and configuration loader for TypeScript. Declare a schema
with fluent field builders and get back a fully type-inferred config object —
with coercion, validation, defaults, and **all** failures reported at once.

Zero runtime dependencies.

## Install

```sh
pnpm add @brokkr/config
```

## Usage

```ts
import { loadConfig, str, num, bool, port, enumOf, json } from "@brokkr/config";

const config = loadConfig({
  PORT: port().default(3000),
  NODE_ENV: enumOf(["dev", "prod"] as const),
  DEBUG: bool().optional(),
  DATABASE_URL: str(),
  RETRIES: num().default(3),
  FEATURE_FLAGS: json<{ beta: boolean }>().default({ beta: false }),
});

// Inferred type:
// {
//   PORT: number;
//   NODE_ENV: "dev" | "prod";
//   DEBUG: boolean | undefined;
//   DATABASE_URL: string;
//   RETRIES: number;
//   FEATURE_FLAGS: { beta: boolean };
// }
```

By default the source is `process.env`; pass a second argument to load from any
`Record<string, string | undefined>` (handy for tests).

```ts
const config = loadConfig({ PORT: port() }, { PORT: "8080" });
```

## Field builders

| Builder          | Coerced type      | Accepts                                                  |
| ---------------- | ----------------- | -------------------------------------------------------- |
| `str()`          | `string`          | any string (verbatim)                                    |
| `num()`          | `number`          | any finite number; blank input rejected                  |
| `bool()`         | `boolean`         | `true`/`false`/`1`/`0`/`yes`/`no` (case-insensitive)     |
| `port()`         | `number`          | integer in `1..65535`                                    |
| `enumOf(values)` | union of `values` | a member of `values` (use `as const` for a precise type) |
| `json<T>()`      | `T`               | any valid JSON (parsed, not schema-checked)              |

### Presence modifiers

Every builder returns a spec with two fluent modifiers:

- `.default(value)` — used when the key is absent; the output type stays `T`.
- `.optional()` — the output becomes `T | undefined` (yields `undefined` when
  absent).

Without either, a field is **required**; an absent key becomes a validation
issue.

## Error handling

`loadConfig` evaluates the whole schema before throwing. If anything is wrong it
throws a single `ConfigError` aggregating **every** problem:

```ts
import { ConfigError, loadConfig, num, port, str } from "@brokkr/config";

try {
  loadConfig({ A: str(), B: num(), PORT: port() }, { B: "nope", PORT: "99999" });
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    // Configuration validation failed with 3 issue(s):
    //   - A: missing required value
    //   - B: expected a number, got "nope"
    //   - PORT: port out of range (1..65535), got 99999
    for (const issue of error.issues) {
      console.error(issue.key, issue.message);
    }
  }
}
```

`ConfigError.issues` is a `{ key, message }[]` in schema-declaration order, so
you never have to fix problems one recompile at a time.

## License

MIT © Yronnel James
