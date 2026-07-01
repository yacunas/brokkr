/**
 * `@brokkr/result` — a typed `Result`/`Either` type for modeling success and
 * failure without throwing exceptions.
 *
 * A {@link Result} is either an {@link Ok} carrying a success value or an
 * {@link Err} carrying an error. All combinators are standalone, pure
 * functions so they tree-shake cleanly and never mutate their inputs.
 *
 * @example
 * ```ts
 * import { ok, err, map, unwrapOr, type Result } from "@brokkr/result";
 *
 * function parse(input: string): Result<number, string> {
 *   const n = Number(input);
 *   return Number.isNaN(n) ? err("not a number") : ok(n);
 * }
 *
 * const doubled = map(parse("21"), (n) => n * 2); // Ok(42)
 * const value = unwrapOr(parse("nope"), 0); // 0
 * ```
 *
 * @packageDocumentation
 */

/**
 * The success variant of a {@link Result}, carrying a value of type `T`.
 *
 * @typeParam T - The type of the contained success value.
 */
export interface Ok<T> {
  /** Discriminant marking this result as successful. */
  readonly ok: true;
  /** The contained success value. */
  readonly value: T;
}

/**
 * The failure variant of a {@link Result}, carrying an error of type `E`.
 *
 * @typeParam E - The type of the contained error.
 */
export interface Err<E> {
  /** Discriminant marking this result as a failure. */
  readonly ok: false;
  /** The contained error. */
  readonly error: E;
}

/**
 * A value that is either a success ({@link Ok}) or a failure ({@link Err}).
 *
 * Use the {@link ok} and {@link err} constructors to build a `Result`, and the
 * combinators in this module (such as {@link map}, {@link andThen}, and
 * {@link match}) to transform it without unwrapping prematurely.
 *
 * @typeParam T - The type of the success value.
 * @typeParam E - The type of the error. Defaults to the built-in `Error`.
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/**
 * Wraps a value in an {@link Ok}, marking it as a success.
 *
 * @typeParam T - The type of the value.
 * @param value - The success value to wrap.
 * @returns An {@link Ok} containing `value`.
 *
 * @example
 * ```ts
 * const result = ok(42); // Ok<number>
 * ```
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Wraps an error in an {@link Err}, marking it as a failure.
 *
 * @typeParam E - The type of the error.
 * @param error - The error value to wrap.
 * @returns An {@link Err} containing `error`.
 *
 * @example
 * ```ts
 * const result = err(new Error("boom")); // Err<Error>
 * ```
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Type guard that narrows a {@link Result} to its {@link Ok} variant.
 *
 * @typeParam T - The success type.
 * @typeParam E - The error type.
 * @param result - The result to inspect.
 * @returns `true` if `result` is an {@link Ok}, narrowing the type accordingly.
 *
 * @example
 * ```ts
 * if (isOk(result)) {
 *   console.log(result.value); // narrowed to Ok<T>
 * }
 * ```
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Type guard that narrows a {@link Result} to its {@link Err} variant.
 *
 * @typeParam T - The success type.
 * @typeParam E - The error type.
 * @param result - The result to inspect.
 * @returns `true` if `result` is an {@link Err}, narrowing the type accordingly.
 *
 * @example
 * ```ts
 * if (isErr(result)) {
 *   console.error(result.error); // narrowed to Err<E>
 * }
 * ```
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Transforms the success value of a {@link Result} with `fn`, leaving an
 * {@link Err} untouched.
 *
 * @typeParam T - The input success type.
 * @typeParam U - The mapped success type.
 * @typeParam E - The error type.
 * @param result - The result to map over.
 * @param fn - A function applied to the value when `result` is {@link Ok}.
 * @returns A new {@link Result} with the value transformed, or the original
 * {@link Err}.
 *
 * @example
 * ```ts
 * map(ok(2), (n) => n * 10); // Ok(20)
 * map(err("bad"), (n: number) => n * 10); // Err("bad")
 * ```
 */
/** Extracts the success type `T` from a `Result` (distributes over unions). */
type OkOf<R> = R extends Ok<infer T> ? T : never;
/** Extracts the error type `E` from a `Result` (distributes over unions). */
type ErrOf<R> = R extends Err<infer E> ? E : never;

export function map<R extends Result<unknown, unknown>, U>(
  result: R,
  fn: (value: OkOf<R>) => U,
): Result<U, ErrOf<R>> {
  return (result.ok ? ok(fn(result.value as OkOf<R>)) : result) as Result<U, ErrOf<R>>;
}

/**
 * Transforms the error of a {@link Result} with `fn`, leaving an {@link Ok}
 * untouched.
 *
 * @typeParam T - The success type.
 * @typeParam E - The input error type.
 * @typeParam F - The mapped error type.
 * @param result - The result to map over.
 * @param fn - A function applied to the error when `result` is {@link Err}.
 * @returns A new {@link Result} with the error transformed, or the original
 * {@link Ok}.
 *
 * @example
 * ```ts
 * mapErr(err("boom"), (msg) => new Error(msg)); // Err<Error>
 * ```
 */
export function mapErr<R extends Result<unknown, unknown>, F>(
  result: R,
  fn: (error: ErrOf<R>) => F,
): Result<OkOf<R>, F> {
  return (result.ok ? result : err(fn(result.error as ErrOf<R>))) as Result<OkOf<R>, F>;
}

/**
 * Chains a {@link Result}-returning function onto a {@link Result}, flattening
 * the outcome. Also known as `flatMap` or `bind`. An {@link Err} short-circuits
 * and `fn` is not called.
 *
 * @typeParam T - The input success type.
 * @typeParam U - The success type produced by `fn`.
 * @typeParam E - The error type.
 * @param result - The result to chain from.
 * @param fn - A function returning a new {@link Result}, applied when `result`
 * is {@link Ok}.
 * @returns The {@link Result} produced by `fn`, or the original {@link Err}.
 *
 * @example
 * ```ts
 * const half = (n: number) =>
 *   n % 2 === 0 ? ok(n / 2) : err("odd");
 *
 * andThen(ok(8), half); // Ok(4)
 * andThen(ok(7), half); // Err("odd")
 * andThen(err("x"), half); // Err("x") — half never runs
 * ```
 */
export function andThen<R extends Result<unknown, unknown>, U, E2>(
  result: R,
  fn: (value: OkOf<R>) => Result<U, E2>,
): Result<U, ErrOf<R> | E2> {
  return (result.ok ? fn(result.value as OkOf<R>) : result) as Result<U, ErrOf<R> | E2>;
}

/**
 * Extracts the success value from a {@link Result}, throwing the contained
 * error when the result is an {@link Err}.
 *
 * Prefer {@link unwrapOr} or {@link match} when you can handle failure without
 * throwing. Use `unwrap` only at boundaries where an {@link Err} is genuinely
 * exceptional.
 *
 * @typeParam T - The success type.
 * @typeParam E - The error type.
 * @param result - The result to unwrap.
 * @returns The contained value when `result` is {@link Ok}.
 * @throws The contained error when `result` is {@link Err}.
 *
 * @example
 * ```ts
 * unwrap(ok(1)); // 1
 * unwrap(err(new Error("nope"))); // throws Error: nope
 * ```
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

/**
 * Extracts the success value from a {@link Result}, returning `fallback` when
 * the result is an {@link Err}.
 *
 * @typeParam T - The success type.
 * @typeParam E - The error type.
 * @param result - The result to unwrap.
 * @param fallback - The value returned when `result` is {@link Err}.
 * @returns The contained value, or `fallback`.
 *
 * @example
 * ```ts
 * unwrapOr(ok(1), 0); // 1
 * unwrapOr(err("x"), 0); // 0
 * ```
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Pattern-matches over a {@link Result}, invoking `ok` for the success value or
 * `err` for the error, and returning a single unified value.
 *
 * @typeParam T - The success type.
 * @typeParam E - The error type.
 * @typeParam R - The unified return type of both branches.
 * @param result - The result to match on.
 * @param branches - Handlers for each variant.
 * @param branches.ok - Called with the value when `result` is {@link Ok}.
 * @param branches.err - Called with the error when `result` is {@link Err}.
 * @returns The value returned by whichever branch ran.
 *
 * @example
 * ```ts
 * const label = match(result, {
 *   ok: (n) => `got ${n}`,
 *   err: (e) => `failed: ${e}`,
 * });
 * ```
 */
export function match<T, E, R>(
  result: Result<T, E>,
  branches: { ok: (value: T) => R; err: (error: E) => R },
): R {
  return result.ok ? branches.ok(result.value) : branches.err(result.error);
}

/**
 * Runs a synchronous function and captures its outcome as a {@link Result},
 * converting a thrown value into an {@link Err}.
 *
 * Thrown values that are not already `Error` instances are wrapped in an
 * `Error` so the error channel is always typed as `Error`.
 *
 * @typeParam T - The return type of `fn`.
 * @param fn - The function to execute.
 * @returns An {@link Ok} with the return value, or an {@link Err} with the
 * thrown error.
 *
 * @example
 * ```ts
 * const parsed = fromThrowable(() => JSON.parse(input));
 * ```
 */
export function fromThrowable<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (error) {
    return err(toError(error));
  }
}

/**
 * Awaits a promise and captures its outcome as a {@link Result}. The returned
 * promise never rejects — a rejection becomes an {@link Err}.
 *
 * Rejection reasons that are not already `Error` instances are wrapped in an
 * `Error` so the error channel is always typed as `Error`.
 *
 * @typeParam T - The resolved value type of the promise.
 * @param promise - The promise to settle.
 * @returns A promise resolving to an {@link Ok} with the resolved value, or an
 * {@link Err} with the rejection reason.
 *
 * @example
 * ```ts
 * const result = await fromPromise(fetch("/api"));
 * ```
 */
export async function fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await promise);
  } catch (error) {
    return err(toError(error));
  }
}

/**
 * Collects an array of {@link Result}s into a single {@link Result} of an
 * array. Returns the first {@link Err} encountered (short-circuiting), or an
 * {@link Ok} of all values when every element succeeds.
 *
 * @typeParam T - The success type of each element.
 * @typeParam E - The error type of each element.
 * @param results - The results to collect.
 * @returns An {@link Ok} containing every value in order, or the first
 * {@link Err}.
 *
 * @example
 * ```ts
 * all([ok(1), ok(2), ok(3)]); // Ok([1, 2, 3])
 * all([ok(1), err("bad"), ok(3)]); // Err("bad")
 * ```
 */
export function all<T, E>(results: ReadonlyArray<Result<T, E>>): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Normalizes an unknown thrown value into an `Error` instance.
 *
 * @param value - The caught value.
 * @returns `value` if it is already an `Error`, otherwise a new `Error`
 * wrapping its string form.
 * @internal
 */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
