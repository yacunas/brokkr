# @brokkr/result

A typed `Result`/`Either` type for error handling without exceptions. Model
success and failure as ordinary values, then transform them with pure,
tree-shakeable combinators. Zero runtime dependencies.

## Install

```sh
pnpm add @brokkr/result
```

## The type

```ts
type Result<T, E = Error> = Ok<T> | Err<E>;

interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

interface Err<E> {
  readonly ok: false;
  readonly error: E;
}
```

A `Result` is either an `Ok` carrying a value or an `Err` carrying an error.
The `ok` discriminant lets TypeScript narrow between the two.

## Quick start

```ts
import { ok, err, map, andThen, match, type Result } from "@brokkr/result";

function parse(input: string): Result<number, string> {
  const n = Number(input);
  return Number.isNaN(n) ? err(`not a number: ${input}`) : ok(n);
}

const doubled = map(parse("21"), (n) => n * 2); // Ok(42)

const message = match(parse("nope"), {
  ok: (n) => `parsed ${n}`,
  err: (e) => `error: ${e}`,
}); // "error: not a number: nope"
```

## API

### Constructors

- `ok<T>(value)` — build a success.
- `err<E>(error)` — build a failure.

### Guards

- `isOk(result)` — type guard narrowing to `Ok<T>`.
- `isErr(result)` — type guard narrowing to `Err<E>`.

### Combinators

All combinators are pure and return a new `Result`.

- `map(result, fn)` — transform the success value; passes `Err` through.
- `mapErr(result, fn)` — transform the error; passes `Ok` through.
- `andThen(result, fn)` — chain a `Result`-returning function (a.k.a.
  `flatMap`). An `Err` short-circuits and `fn` is not called.
- `unwrap(result)` — return the value, or **throw** the contained error.
- `unwrapOr(result, fallback)` — return the value, or `fallback` on `Err`.
- `match(result, { ok, err })` — collapse both variants into one value.

### Interop

- `fromThrowable(fn)` — run a sync function, returning `Result<T, Error>`.
- `fromPromise(promise)` — settle a promise into `Promise<Result<T, Error>>`;
  the returned promise never rejects.
- `all(results)` — collect `Result<T, E>[]` into `Result<T[], E>`, returning
  the first `Err` (short-circuiting).

Non-`Error` throws and rejections are wrapped in an `Error`, so `fromThrowable`
and `fromPromise` always type their error channel as `Error`.

## Example: interop

```ts
import { fromPromise, fromThrowable, all, unwrapOr } from "@brokkr/result";

const config = fromThrowable(() => JSON.parse(process.env.CONFIG ?? "{}"));

const response = await fromPromise(fetch("/api/health"));

const combined = all([config, response]); // first Err short-circuits
const healthy = unwrapOr(response, undefined);
```

## License

MIT © Yronnel James
