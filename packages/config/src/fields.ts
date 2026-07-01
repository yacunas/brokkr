/**
 * Discriminates the kind of value a {@link FieldSpec} coerces to. Useful for
 * tooling and diagnostics; coercion itself is driven by the spec's parser.
 */
export type FieldKind = "str" | "num" | "bool" | "port" | "enum" | "json";

/** Internal shape passed to the {@link FieldSpec} constructor. */
interface FieldSpecInit<T> {
  readonly kind: FieldKind;
  /** Coerce a raw string into `T`, throwing an `Error` with a readable
   * message when the value is invalid. */
  readonly parse: (raw: string) => T;
  readonly hasDefault: boolean;
  readonly defaultValue: T | undefined;
  readonly isOptional: boolean;
  /** Populated only for {@link enumOf} specs. */
  readonly enumValues: readonly string[] | undefined;
}

/**
 * A field specification produced by a builder such as {@link str} or
 * {@link num}.
 *
 * The two type parameters carry information for {@link loadConfig}:
 * - `T` is the coerced value type (e.g. `number` for {@link port}).
 * - `Out` is the *output* type the field contributes to the loaded config.
 *   It starts equal to `T` (a required field) and is widened to
 *   `T | undefined` by {@link FieldSpec.optional}, or kept as `T` by
 *   {@link FieldSpec.default}.
 *
 * `Out` is tracked purely at the type level via the phantom `__out` member,
 * which never exists at runtime.
 */
export class FieldSpec<T, Out = T> {
  /** The value category this field coerces to. */
  readonly kind: FieldKind;
  /** Coerces a raw string into `T`, throwing on invalid input. */
  readonly parse: (raw: string) => T;
  /** Whether a default value has been supplied via {@link FieldSpec.default}. */
  readonly hasDefault: boolean;
  /** The default value, when {@link FieldSpec.hasDefault} is `true`. */
  readonly defaultValue: T | undefined;
  /** Whether the field was marked optional via {@link FieldSpec.optional}. */
  readonly isOptional: boolean;
  /** Allowed members for {@link enumOf} specs, otherwise `undefined`. */
  readonly enumValues: readonly string[] | undefined;

  /** Phantom type carrier — never assigned at runtime. */
  declare readonly __out: Out;

  constructor(init: FieldSpecInit<T>) {
    this.kind = init.kind;
    this.parse = init.parse;
    this.hasDefault = init.hasDefault;
    this.defaultValue = init.defaultValue;
    this.isOptional = init.isOptional;
    this.enumValues = init.enumValues;
  }

  /**
   * Supplies a fallback used when the key is absent from the source. A field
   * with a default is never missing, so its output type stays `T`.
   */
  default(value: T): FieldSpec<T, T> {
    return new FieldSpec<T, T>({
      kind: this.kind,
      parse: this.parse,
      hasDefault: true,
      defaultValue: value,
      isOptional: false,
      enumValues: this.enumValues,
    });
  }

  /**
   * Marks the field as optional. When the key is absent, the loaded value is
   * `undefined`, widening the output type to `T | undefined`.
   */
  optional(): FieldSpec<T, T | undefined> {
    return new FieldSpec<T, T | undefined>({
      kind: this.kind,
      parse: this.parse,
      hasDefault: this.hasDefault,
      defaultValue: this.defaultValue,
      isOptional: true,
      enumValues: this.enumValues,
    });
  }
}

/** Builds a required string field. No coercion is applied. */
export function str(): FieldSpec<string> {
  return new FieldSpec<string>({
    kind: "str",
    parse: (raw) => raw,
    hasDefault: false,
    defaultValue: undefined,
    isOptional: false,
    enumValues: undefined,
  });
}

/**
 * Builds a finite-number field. Rejects empty/blank input and any value that
 * does not parse to a finite number.
 */
export function num(): FieldSpec<number> {
  return new FieldSpec<number>({
    kind: "num",
    parse: (raw) => {
      if (raw.trim() === "") {
        throw new Error(`expected a number, got an empty string`);
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`expected a number, got "${raw}"`);
      }
      return n;
    },
    hasDefault: false,
    defaultValue: undefined,
    isOptional: false,
    enumValues: undefined,
  });
}

/**
 * Builds a boolean field. Accepts `true`/`false`/`1`/`0`/`yes`/`no`
 * case-insensitively (surrounding whitespace is ignored).
 */
export function bool(): FieldSpec<boolean> {
  const truthy = new Set(["true", "1", "yes"]);
  const falsy = new Set(["false", "0", "no"]);
  return new FieldSpec<boolean>({
    kind: "bool",
    parse: (raw) => {
      const value = raw.trim().toLowerCase();
      if (truthy.has(value)) return true;
      if (falsy.has(value)) return false;
      throw new Error(`expected a boolean (true/false/1/0/yes/no), got "${raw}"`);
    },
    hasDefault: false,
    defaultValue: undefined,
    isOptional: false,
    enumValues: undefined,
  });
}

/**
 * Builds a TCP/UDP port field: an integer in the inclusive range `1..65535`.
 */
export function port(): FieldSpec<number> {
  return new FieldSpec<number>({
    kind: "port",
    parse: (raw) => {
      if (raw.trim() === "") {
        throw new Error(`expected an integer port, got an empty string`);
      }
      const n = Number(raw);
      if (!Number.isInteger(n)) {
        throw new Error(`expected an integer port, got "${raw}"`);
      }
      if (n < 1 || n > 65535) {
        throw new Error(`port out of range (1..65535), got ${n}`);
      }
      return n;
    },
    hasDefault: false,
    defaultValue: undefined,
    isOptional: false,
    enumValues: undefined,
  });
}

/**
 * Builds a field constrained to one of a fixed set of string literals. Pass
 * the values `as const` (or a `readonly` tuple) to infer a precise union.
 *
 * @example
 * enumOf(["dev", "prod"] as const); // FieldSpec<"dev" | "prod">
 */
export function enumOf<const V extends string>(values: readonly V[]): FieldSpec<V> {
  const allowed = values as readonly string[];
  return new FieldSpec<V>({
    kind: "enum",
    parse: (raw) => {
      if (allowed.includes(raw)) {
        return raw as V;
      }
      const list = values.map((v) => `"${v}"`).join(", ");
      throw new Error(`expected one of ${list}, got "${raw}"`);
    },
    hasDefault: false,
    defaultValue: undefined,
    isOptional: false,
    enumValues: values,
  });
}

/**
 * Builds a field whose raw value is parsed as JSON. Supply the expected shape
 * as the type argument; parsing is unchecked beyond valid JSON syntax.
 *
 * @example
 * json<{ retries: number }>();
 */
export function json<T>(): FieldSpec<T> {
  return new FieldSpec<T>({
    kind: "json",
    parse: (raw) => {
      try {
        return JSON.parse(raw) as T;
      } catch (error) {
        throw new Error(`invalid JSON: ${(error as Error).message}`);
      }
    },
    hasDefault: false,
    defaultValue: undefined,
    isOptional: false,
    enumValues: undefined,
  });
}
