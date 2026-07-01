import { type Codec, type SerdeConfig } from "./codec";
import { builtinCodecs } from "./codecs";
import { RESERVED, runDecode, runEncode, type Runtime } from "./engine";
import { SerdeError } from "./errors";
import type { JsonValue } from "./types";

const DEFAULT_MAX_DEPTH = 10_000;

/**
 * The engine: a registry of codecs plus the serialize/deserialize operations.
 *
 * A `Serde` instance is a plain class with a normal constructor, so it drops
 * straight into any DI container — including NestJS, where you can provide it
 * with {@link provideSerde} and inject the class token. Create one per app (or
 * per bounded context) and register the codecs that context needs.
 *
 * @example Plain usage
 * const serde = new Serde({ codecs: [decimalCodec] });
 * const wire = serde.serialize({ price: new Decimal("9.99"), at: new Date() });
 * const back = serde.deserialize(wire);
 *
 * @example NestJS
 * // app.module.ts
 * @Module({ providers: [provideSerde({ codecs: [decimalCodec] })], exports: [Serde] })
 * export class AppModule {}
 * // any.service.ts
 * constructor(private readonly serde: Serde) {}
 */
export class Serde {
  private readonly rt: Runtime;

  constructor(config: SerdeConfig = {}) {
    this.rt = {
      maxDepth: config.maxDepth ?? DEFAULT_MAX_DEPTH,
      byName: new Map(),
      byCtor: new Map(),
      tests: [],
    };
    for (const codec of builtinCodecs) this.register(codec);
    if (config.codecs) for (const codec of config.codecs) this.register(codec);
  }

  /** The configured maximum nesting depth. */
  get maxDepth(): number {
    return this.rt.maxDepth;
  }

  /** Register (or, by matching `name`, replace) a codec. Chainable. */
  register(codec: Codec): this {
    if (RESERVED.has(codec.name)) {
      throw new SerdeError(`Codec name "${codec.name}" is reserved by the engine`);
    }
    if (codec.ctor === undefined && codec.test === undefined) {
      throw new SerdeError(`Codec "${codec.name}" must define a "ctor" or a "test" for dispatch`);
    }
    this.rt.byName.set(codec.name, codec);
    this.reindex();
    return this;
  }

  /** Remove a codec by name. Returns whether one was removed. */
  unregister(name: string): boolean {
    const removed = this.rt.byName.delete(name);
    if (removed) this.reindex();
    return removed;
  }

  /** Whether a codec with this name is registered. */
  has(name: string): boolean {
    return this.rt.byName.has(name);
  }

  /** Names of all registered codecs, in registration order. */
  codecs(): string[] {
    return [...this.rt.byName.keys()];
  }

  /**
   * Create a new instance with this one's codecs plus any extras — handy for a
   * feature module that needs an extra codec without mutating the shared root.
   */
  extend(config: SerdeConfig = {}): Serde {
    const next = new Serde({ maxDepth: config.maxDepth ?? this.rt.maxDepth });
    for (const codec of this.rt.byName.values()) next.register(codec);
    if (config.codecs) for (const codec of config.codecs) next.register(codec);
    return next;
  }

  private reindex(): void {
    this.rt.byCtor.clear();
    this.rt.tests = [];
    for (const codec of this.rt.byName.values()) {
      if (codec.ctor !== undefined) this.rt.byCtor.set(codec.ctor, codec);
      else if (codec.test !== undefined) this.rt.tests.push(codec);
    }
  }

  /** Convert a value into a JSON-safe tree (no stringify) — ideal for JSONB columns. */
  encode(value: unknown): JsonValue {
    return runEncode(this.rt, value);
  }

  /** Rebuild a value from a tree produced by {@link Serde.encode}. */
  decode<T = unknown>(node: JsonValue): T {
    return runDecode(this.rt, node) as T;
  }

  /** Serialize a value to a JSON string. */
  serialize(value: unknown): string {
    return JSON.stringify(runEncode(this.rt, value));
  }

  /** Parse a string produced by {@link Serde.serialize} back into a value. */
  deserialize<T = unknown>(text: string): T {
    return runDecode(this.rt, JSON.parse(text) as JsonValue) as T;
  }

  /** Deep-clone a value through a full encode/decode round-trip. */
  clone<T>(value: T): T {
    return runDecode(this.rt, runEncode(this.rt, value)) as T;
  }
}

/** DI token for injecting a {@link Serde}. Use the class itself, or this symbol. */
export const SERDE: unique symbol = Symbol.for("brokkr.serde-engine");

/**
 * Build a NestJS/DI provider descriptor for a configured {@link Serde}. Returns a
 * plain `{ provide, useValue }` object so this package needs no NestJS dependency.
 *
 * @example
 * @Module({ providers: [provideSerde({ codecs: [decimalCodec] })], exports: [Serde] })
 * export class AppModule {}
 */
export function provideSerde(config: SerdeConfig = {}): {
  provide: typeof Serde;
  useValue: Serde;
} {
  return { provide: Serde, useValue: new Serde(config) };
}
