import { ConfigError, type ConfigIssue } from "./errors.js";
import { FieldSpec } from "./fields.js";

/** A schema maps output keys to field specifications. */
export type Schema = Record<string, FieldSpec<unknown, unknown>>;

/** Extracts the output type contributed by a single {@link FieldSpec}. */
export type Infer<S> = S extends FieldSpec<unknown, infer Out> ? Out : never;

/**
 * The fully-typed configuration object produced by {@link loadConfig} for a
 * given schema. Each property's type is inferred from its field spec:
 * required → `T`, optional → `T | undefined`, defaulted → `T`.
 */
export type Config<S extends Schema> = {
  [K in keyof S]: Infer<S[K]>;
};

/**
 * Loads and validates configuration from a source map (defaulting to
 * `process.env`) according to `schema`.
 *
 * Each key is resolved independently:
 * - If the source value is `undefined` the field is *absent*: a defaulted
 *   field yields its default, an optional field yields `undefined`, and a
 *   plain required field produces a "missing required value" issue.
 * - Otherwise the raw string is coerced by the field's parser; coercion
 *   failures produce an issue.
 *
 * Every key is evaluated before any error is raised. If one or more issues
 * were found, a single {@link ConfigError} aggregating all of them is thrown.
 *
 * @throws {ConfigError} when any field is missing or fails coercion.
 *
 * @example
 * const cfg = loadConfig({
 *   PORT: port().default(3000),
 *   NODE_ENV: enumOf(["dev", "prod"] as const),
 *   DEBUG: bool().optional(),
 * });
 * // cfg: { PORT: number; NODE_ENV: "dev" | "prod"; DEBUG: boolean | undefined }
 */
export function loadConfig<S extends Schema>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): Config<S> {
  const result: Record<string, unknown> = {};
  const issues: ConfigIssue[] = [];

  for (const key of Object.keys(schema)) {
    const spec = schema[key];
    if (spec === undefined) continue;

    const raw = source[key];
    if (raw === undefined) {
      if (spec.hasDefault) {
        result[key] = spec.defaultValue;
      } else if (spec.isOptional) {
        result[key] = undefined;
      } else {
        issues.push({ key, message: "missing required value" });
      }
      continue;
    }

    try {
      result[key] = spec.parse(raw);
    } catch (error) {
      issues.push({ key, message: (error as Error).message });
    }
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return result as Config<S>;
}
