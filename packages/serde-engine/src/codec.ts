import type {
  DecodeContext,
  DecodeMeta,
  EncodeContext,
  JsonValue,
} from "./types";

/**
 * Teaches the engine how to round-trip one non-JSON-native type — a `Date`, a
 * `Decimal`, a domain value object, anything. Extend this class (or one of its
 * subclasses below) so `serialize`/`deserialize` are strongly typed against your
 * value `T` and its on-the-wire payload `S`.
 *
 * Dispatch: provide {@link Codec.ctor} for O(1) constructor matching, or override
 * {@link Codec.test} for a custom predicate — the engine needs one of them.
 *
 * Override by name: registering a codec whose `name` already exists replaces the
 * previous one, which is how you swap out a built-in (e.g. a stricter `Date`).
 *
 * @typeParam T - the runtime type this codec handles.
 * @typeParam S - the JSON-safe payload shape it (de)serializes to/from.
 *
 * @example
 * class PointCodec extends Codec<Point, [number, number]> {
 *   readonly name = "Point";
 *   readonly ctor = Point;
 *   serialize(p: Point) { return [p.x, p.y] as [number, number]; }
 *   deserialize([x, y]: [number, number]) { return new Point(x, y); }
 * }
 */
export abstract class Codec<T = unknown, S extends JsonValue = JsonValue> {
  /** Stable, unique tag written into the payload. Must not be a reserved tag. */
  abstract readonly name: string;

  /**
   * Payload format version, written alongside the data. Bump it whenever the
   * output of {@link Codec.serialize} changes shape so old payloads can be
   * migrated on read — see {@link VersionedCodec}. Defaults to `1`.
   */
  readonly version: number = 1;

  /** Constructor used for fast dispatch. Provide this or override {@link Codec.test}. */
  readonly ctor?: Function;

  /** Runtime predicate for dispatch when a constructor is not enough. */
  test?(value: unknown): boolean;

  /** Convert an instance into a JSON-safe payload; use `ctx.encode` for nesting. */
  abstract serialize(value: T, ctx: EncodeContext): S;

  /** Rebuild an instance from its payload; use `ctx.decode` for nesting. */
  abstract deserialize(data: S, ctx: DecodeContext, meta: DecodeMeta): T;
}

/**
 * A {@link Codec} dispatched by `instanceof` on a constructor. Set `ctor` and the
 * `test` predicate is provided for you.
 */
export abstract class ClassCodec<
  T = unknown,
  S extends JsonValue = JsonValue,
> extends Codec<T, S> {
  abstract override readonly ctor: new (...args: any[]) => T;

  override test = (value: unknown): boolean => value instanceof this.ctor;
}

/**
 * Convenience base for the common case: a class that maps to/from a single scalar
 * payload with no nested values to recurse into (e.g. `Date` ⇄ ISO string).
 * Implement {@link ClassScalarCodec.encode} / {@link ClassScalarCodec.decode}.
 */
export abstract class ClassScalarCodec<
  T = unknown,
  S extends JsonValue = JsonValue,
> extends ClassCodec<T, S> {
  /** Flatten the value into its scalar payload. */
  abstract encode(value: T): S;
  /** Reconstruct the value from its scalar payload. */
  abstract decode(data: S): T;

  override serialize(value: T): S {
    return this.encode(value);
  }
  override deserialize(data: S): T {
    return this.decode(data);
  }
}

/**
 * Base for codecs whose payload format evolves over time. Set the current
 * {@link VersionedCodec.version}, implement {@link VersionedCodec.write} /
 * {@link VersionedCodec.read} for the current shape, and override
 * {@link VersionedCodec.upgrade} to migrate older payloads forward. When a value
 * serialized by an older version is read, `upgrade` runs first, so `read` only
 * ever sees the current shape — that is the backward-compatibility guarantee.
 *
 * @example
 * class MoneyCodec extends VersionedCodec<Money, MoneyV2> {
 *   readonly name = "Money";
 *   readonly ctor = Money;
 *   readonly version = 2;
 *   write(m: Money): MoneyV2 { return { cents: m.cents, currency: m.currency }; }
 *   read(d: MoneyV2): Money { return new Money(d.cents, d.currency); }
 *   protected upgrade(old: JsonValue, from: number): MoneyV2 {
 *     if (from === 1) { // v1 stored whole dollars as a number
 *       return { cents: (old as number) * 100, currency: "USD" };
 *     }
 *     return old as MoneyV2;
 *   }
 * }
 */
export abstract class VersionedCodec<
  T = unknown,
  S extends JsonValue = JsonValue,
> extends ClassCodec<T, S> {
  abstract override readonly version: number;

  /** Migrate a payload written by `fromVersion` into the current shape `S`. */
  protected upgrade(data: JsonValue, _fromVersion: number): S {
    return data as S;
  }

  /** Serialize the value using the current format. */
  abstract write(value: T, ctx: EncodeContext): S;
  /** Deserialize a current-format payload back into a value. */
  abstract read(data: S, ctx: DecodeContext): T;

  override serialize(value: T, ctx: EncodeContext): S {
    return this.write(value, ctx);
  }

  override deserialize(data: S, ctx: DecodeContext, meta: DecodeMeta): T {
    const current =
      meta.version < this.version ? this.upgrade(data, meta.version) : data;
    return this.read(current, ctx);
  }
}

/** Plain-object description of a codec, for {@link defineCodec}. */
export interface CodecSpec<T = unknown, S extends JsonValue = JsonValue> {
  name: string;
  version?: number;
  ctor?: Function;
  test?: (value: unknown) => boolean;
  serialize: (value: T, ctx: EncodeContext) => S;
  deserialize: (data: S, ctx: DecodeContext, meta: DecodeMeta) => T;
}

/**
 * Build a {@link Codec} from a plain object — the terse alternative to subclassing
 * when you do not need inheritance. You must supply `ctor` or `test` for dispatch.
 *
 * @example
 * const decimalCodec = defineCodec<Decimal, string>({
 *   name: "Decimal",
 *   ctor: Decimal,
 *   serialize: (d) => d.toString(),
 *   deserialize: (s) => new Decimal(s),
 * });
 */
export function defineCodec<T = unknown, S extends JsonValue = JsonValue>(
  spec: CodecSpec<T, S>,
): Codec<T, S> {
  return new (class extends Codec<T, S> {
    readonly name = spec.name;
    override readonly version = spec.version ?? 1;
    override readonly ctor = spec.ctor;
    override test = spec.test;
    serialize = spec.serialize;
    deserialize = spec.deserialize;
  })();
}

/** Options accepted by the `Serde` constructor and `Serde.extend`. */
export interface SerdeConfig {
  /**
   * Maximum nesting depth before a `MaxDepthError` is thrown, guarding against
   * runaway/cyclic structures and stack overflow. Defaults to 10_000.
   */
  maxDepth?: number;
  /** Additional codecs registered on top of the built-ins. */
  codecs?: Codec[];
}
