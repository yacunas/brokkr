# @brokkr/serde-engine

> Structured, extensible, versioned serialization for TypeScript. Zero dependencies.

`JSON.stringify` quietly loses information: `Date` becomes a string, `Map`/`Set`
collapse to `{}`, `BigInt` throws, `undefined`/`NaN`/`Infinity` vanish. **serde-engine**
round-trips all of them, lets you teach it your _own_ types, reports exactly where
serialization failed, supports payload **versioning** for backward compatibility, and
ships as a plain **injectable** class that fits any DI container (NestJS included).

- ✅ Round-trips `Date`, `Map`, `Set`, `RegExp`, `URL`, `BigInt`, `undefined`, `NaN`, `±Infinity`
- ✅ Extensible via strongly-typed **codecs** (abstract classes or a plain factory)
- ✅ **Unlimited nesting** — maps of sets of arrays of objects of dates, all the way down
- ✅ **Cycle detection** and a configurable **max-depth** guard (no silent stack overflow)
- ✅ **Precise, typed errors** with a JSON-path to the offending value
- ✅ **Versioned** codecs with a migration hook for backward compatibility
- ✅ **Injectable** (`Serde` class + `provideSerde()` for NestJS) — no framework dependency
- ✅ **Zero runtime dependencies**, ESM + CJS + types

## Install

```bash
pnpm add @brokkr/serde-engine
```

## Quick start

```ts
import { serialize, deserialize } from "@brokkr/serde-engine";

const wire = serialize({
  id: 1n, // BigInt
  when: new Date("2026-01-01"), // Date
  tags: new Set(["a", "b"]), // Set
  meta: new Map([["k", 1]]), // Map
  missing: undefined, // undefined
});

const value = deserialize<typeof original>(wire);
// value.id is a BigInt again, value.when is a Date, value.tags is a Set, …
```

`encode`/`decode` do the same without the `JSON.stringify` step — return a JSON-safe
tree instead of a string, which is ideal for a Postgres `jsonb` column or a message body:

```ts
import { encode, decode } from "@brokkr/serde-engine";
const json = encode(value); // plain JSON-safe object/array tree
const back = decode(json);
```

## Custom types (codecs)

A **codec** teaches the engine one non-native type. Extend an abstract base for full
type inference, or use the `defineCodec` factory for a quick one-off.

```ts
import Decimal from "decimal.js";
import { ClassScalarCodec, Serde } from "@brokkr/serde-engine";

class DecimalCodec extends ClassScalarCodec<Decimal, string> {
  readonly name = "Decimal";
  readonly ctor = Decimal;
  encode(d: Decimal) {
    return d.toString();
  }
  decode(s: string) {
    return new Decimal(s);
  }
}

const serde = new Serde({ codecs: [new DecimalCodec()] });
serde.serialize({ price: new Decimal("9.99") }); // Decimal survives the round-trip
```

### Base classes

| Base                     | Use it when                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `Codec<T, S>`            | Full control — provide `serialize`/`deserialize` and `ctor` **or** `match`.         |
| `ClassCodec<T, S>`       | Dispatch by `instanceof` — just set `ctor`.                                         |
| `ClassScalarCodec<T, S>` | The value maps to a single scalar (no nested values) — implement `encode`/`decode`. |
| `VersionedCodec<T, S>`   | The payload format evolves — see **Versioning**.                                    |
| `defineCodec({...})`     | A quick codec without subclassing.                                                  |

Codecs receive an `EncodeContext`/`DecodeContext` so they can recurse into nested
values (`Map` and `Set` are implemented exactly this way):

```ts
class BoxCodec extends ClassCodec<Box, { items: JsonValue }> {
  readonly name = "Box";
  readonly ctor = Box;
  serialize(box: Box, ctx: EncodeContext) {
    return { items: ctx.encode(box.items) };
  }
  deserialize(data: { items: JsonValue }, ctx: DecodeContext) {
    return new Box(ctx.decode(data.items));
  }
}
```

**Overriding a built-in:** register a codec whose `name` matches an existing one
(e.g. `"Date"`) and it replaces the default.

## Versioning (backward compatibility)

When a codec's output shape changes, bump its `version` and migrate old payloads in
`upgrade()`. The version is written into the payload; on read, `upgrade()` runs for
anything older, so `read()` only ever sees the current shape.

```ts
interface MoneyV2 {
  cents: number;
  currency: string;
}

class MoneyCodec extends VersionedCodec<Money, MoneyV2> {
  readonly name = "Money";
  readonly ctor = Money;
  readonly version = 2;

  write(m: Money): MoneyV2 {
    return { cents: m.cents, currency: m.currency };
  }
  read(d: MoneyV2): Money {
    return new Money(d.cents, d.currency);
  }

  // v1 stored whole dollars as a bare number.
  protected upgrade(old: JsonValue, from: number): MoneyV2 {
    if (from === 1) return { cents: (old as number) * 100, currency: "USD" };
    return old as MoneyV2;
  }
}
```

Data written months ago by `v1` still deserializes correctly under `v2`.

## Errors

Every failure is a subclass of `SerdeError` with a machine-readable `code` and a
`path` pointing at the exact value that failed. Importers can catch and branch:

```ts
import { SerdeError, UnknownTypeError } from "@brokkr/serde-engine";

try {
  serde.serialize(payload);
} catch (err) {
  if (err instanceof UnknownTypeError) {
    // err.code === "UNKNOWN_TYPE", err.path === "$.order.customer.balance"
  } else if (err instanceof SerdeError) {
    console.error(err.code, err.path, err.message);
  }
}
```

| Error                    | `code`               | Thrown when                                       |
| ------------------------ | -------------------- | ------------------------------------------------- |
| `UnsupportedTypeError`   | `UNSUPPORTED_TYPE`   | A `symbol` or `function` is encountered.          |
| `UnknownTypeError`       | `UNKNOWN_TYPE`       | A class instance has no registered codec.         |
| `UnknownTagError`        | `UNKNOWN_TAG`        | A payload names a codec that isn't registered.    |
| `CircularReferenceError` | `CIRCULAR_REFERENCE` | A value references one of its ancestors.          |
| `MaxDepthError`          | `MAX_DEPTH_EXCEEDED` | Nesting exceeds `maxDepth`.                       |
| `CodecError`             | `CODEC_ERROR`        | A codec threw; the original error is on `.cause`. |

## Dependency injection / NestJS

`Serde` is a plain class — provide it and inject the class token. `provideSerde()`
returns a standard `{ provide, useValue }` descriptor, so **no NestJS dependency** is
pulled in.

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { Serde, provideSerde } from "@brokkr/serde-engine";

@Module({
  providers: [provideSerde({ codecs: [new DecimalCodec()] })],
  exports: [Serde],
})
export class AppModule {}

// orders.service.ts
@Injectable()
export class OrdersService {
  constructor(private readonly serde: Serde) {}
}
```

Use `serde.extend({ codecs: [...] })` in a feature module to add codecs without
mutating the root instance.

## Works with the other Brokkr libraries

`@brokkr/mongo-vault` and `@brokkr/postgres-vault` use serde-engine to encode their
opaque pagination cursors, and its `encode`/`decode` are a natural fit for a vault's
pluggable row serializer — the same value shape flows losslessly from DB to API.

## API surface

`serialize` · `deserialize` · `encode` · `decode` · `clone` · `serde` (shared instance)
· `Serde` · `provideSerde` · `SERDE` · `Codec` · `ClassCodec` · `ClassScalarCodec` ·
`VersionedCodec` · `defineCodec` · and the `SerdeError` family.

## License

MIT © Yronnel James
