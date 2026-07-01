import type { Codec } from "./codec";
import {
  CircularReferenceError,
  CodecError,
  MaxDepthError,
  SerdeError,
  UnknownTagError,
  UnknownTypeError,
  UnsupportedTypeError,
  type SerdePhase,
} from "./errors";
import type { DecodeContext, DecodeMeta, EncodeContext, JsonValue } from "./types";

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------
// Non-JSON-native values are "boxed" into a small tagged object:
//   { "$brokkr": "<tag>", "v": <payload>, "ver"?: <version> }
// The sentinel key is deliberately unusual; any *plain* object that happens to
// contain it is escaped (tag "$") so decoding is never ambiguous.

const SENTINEL = "$brokkr";
const VALUE = "v";
const VERSION = "ver";

/** Tags reserved by the engine for JS built-ins handled inline (not via codecs). */
const TAG = {
  undefined: "undefined",
  bigint: "bigint",
  number: "number", // NaN / Infinity / -Infinity
  escape: "$", // a plain object that literally contains the sentinel key
} as const;

/** Codec names may not collide with the reserved inline tags above. */
export const RESERVED: ReadonlySet<string> = new Set(Object.values(TAG));

function box(name: string, payload: JsonValue, version = 1): JsonValue {
  return version === 1
    ? { [SENTINEL]: name, [VALUE]: payload }
    : { [SENTINEL]: name, [VALUE]: payload, [VERSION]: version };
}

// ---------------------------------------------------------------------------
// Registry runtime (owned by a Serde instance, shared across calls)
// ---------------------------------------------------------------------------

export interface Runtime {
  maxDepth: number;
  /** Source of truth, insertion-ordered. */
  byName: Map<string, Codec>;
  /** Fast O(1) dispatch for constructor-based codecs. */
  byCtor: Map<Function, Codec>;
  /** Predicate-based codecs, scanned in registration order. */
  matchers: Codec[];
}

function findCodec(rt: Runtime, obj: object): Codec | undefined {
  const ctor = (obj as { constructor?: Function }).constructor;
  if (ctor !== undefined) {
    const byCtor = rt.byCtor.get(ctor);
    if (byCtor !== undefined) return byCtor;
  }
  for (let i = 0; i < rt.matchers.length; i++) {
    const codec = rt.matchers[i]!;
    if (codec.match!(obj)) return codec;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Path tracking (lazy: allocated per container, and on the error path only)
// ---------------------------------------------------------------------------

interface PathNode {
  readonly parent: PathNode | null;
  readonly seg: string;
  readonly depth: number;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function propSeg(key: string): string {
  return IDENT.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function labelSeg(label: string | undefined): string {
  return label ? ` » ${label}` : " » ‹nested›";
}

function format(node: PathNode): string {
  const parts: string[] = [];
  let cur: PathNode | null = node;
  while (cur) {
    parts.push(cur.seg);
    cur = cur.parent;
  }
  return parts.reverse().join("");
}

/** Build a path string for `seg` under `parent` without keeping the node around. */
function loc(parent: PathNode | null, seg: string): string {
  return format({ parent, seg, depth: 0 });
}

function asSerdeError(
  err: unknown,
  codecName: string,
  path: string,
  phase: SerdePhase,
): SerdeError {
  // Errors already produced deeper in the tree keep their precise path/context.
  return err instanceof SerdeError ? err : new CodecError(codecName, path, phase, { cause: err });
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

export function runEncode(rt: Runtime, root: unknown): JsonValue {
  return enc(rt, new WeakSet<object>(), root, null, "$", 0);
}

function enc(
  rt: Runtime,
  seen: WeakSet<object>,
  value: unknown,
  parent: PathNode | null,
  seg: string,
  depth: number,
): JsonValue {
  if (depth > rt.maxDepth) {
    throw new MaxDepthError(rt.maxDepth, loc(parent, seg), "serialize");
  }

  if (value === null) return null;

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (Number.isFinite(value)) {
        // -0 is finite but JSON collapses it to 0; box it to preserve the sign.
        return Object.is(value, -0) ? box(TAG.number, "-0") : value;
      }
      return box(
        TAG.number,
        value === Infinity ? "Infinity" : value === -Infinity ? "-Infinity" : "NaN",
      );
    case "undefined":
      return box(TAG.undefined, 0);
    case "bigint":
      return box(TAG.bigint, value.toString());
    case "symbol":
      throw new UnsupportedTypeError("symbol", loc(parent, seg));
    case "function":
      throw new UnsupportedTypeError("function", loc(parent, seg));
  }

  const obj = value as object;
  if (seen.has(obj)) throw new CircularReferenceError(loc(parent, seg));

  const here: PathNode = { parent, seg, depth };

  const codec = findCodec(rt, obj);
  if (codec) {
    seen.add(obj);
    try {
      const ctx: EncodeContext = {
        encode: (v, label) => enc(rt, seen, v, here, labelSeg(label), depth + 1),
      };
      return box(codec.name, codec.serialize(value, ctx), codec.version);
    } catch (err) {
      throw asSerdeError(err, codec.name, format(here), "serialize");
    } finally {
      seen.delete(obj);
    }
  }

  if (Array.isArray(value)) {
    seen.add(obj);
    try {
      const out: JsonValue[] = new Array(value.length);
      for (let i = 0; i < value.length; i++) {
        out[i] = enc(rt, seen, value[i], here, `[${i}]`, depth + 1);
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  }

  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    seen.add(obj);
    try {
      const out: Record<string, JsonValue> = {};
      let hasSentinel = false;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === SENTINEL) hasSentinel = true;
        safeAssign(out, k, enc(rt, seen, v, here, propSeg(k), depth + 1));
      }
      return hasSentinel ? box(TAG.escape, out) : out;
    } finally {
      seen.delete(obj);
    }
  }

  throw new UnknownTypeError(constructorName(value), loc(parent, seg));
}

function constructorName(value: object): string {
  return (value as { constructor?: { name?: string } }).constructor?.name ?? "Object";
}

/**
 * Assign a property by key, treating a literal `"__proto__"` as an ordinary own
 * data property instead of letting `target[key] = value` reassign the prototype.
 * This keeps such keys round-tripping and blocks prototype-pollution on decode.
 */
function safeAssign(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export function runDecode(rt: Runtime, root: JsonValue): unknown {
  return dec(rt, root, null, "$", 0);
}

function dec(
  rt: Runtime,
  node: JsonValue,
  parent: PathNode | null,
  seg: string,
  depth: number,
): unknown {
  if (depth > rt.maxDepth) {
    throw new MaxDepthError(rt.maxDepth, loc(parent, seg), "deserialize");
  }

  if (node === null || typeof node !== "object") return node;

  const here: PathNode = { parent, seg, depth };

  if (Array.isArray(node)) {
    const out: unknown[] = new Array(node.length);
    for (let i = 0; i < node.length; i++) {
      out[i] = dec(rt, node[i]!, here, `[${i}]`, depth + 1);
    }
    return out;
  }

  const obj = node as Record<string, JsonValue>;
  if (Object.prototype.hasOwnProperty.call(obj, SENTINEL)) {
    const tag = obj[SENTINEL] as string;
    const payload = obj[VALUE] as JsonValue;

    switch (tag) {
      case TAG.undefined:
        return undefined;
      case TAG.bigint:
        try {
          return BigInt(payload as string);
        } catch (err) {
          throw new SerdeError(
            `Invalid BigInt payload ${JSON.stringify(payload)}`,
            { path: format(here), phase: "deserialize" },
            { cause: err },
          );
        }
      case TAG.number:
        return payload === "Infinity"
          ? Infinity
          : payload === "-Infinity"
            ? -Infinity
            : payload === "-0"
              ? -0
              : NaN;
      case TAG.escape:
        return decPlain(rt, payload as Record<string, JsonValue>, here);
    }

    const codec = rt.byName.get(tag);
    if (!codec) throw new UnknownTagError(tag, format(here));

    const rawVersion = obj[VERSION];
    const meta: DecodeMeta = { version: typeof rawVersion === "number" ? rawVersion : 1 };
    try {
      const ctx: DecodeContext = {
        decode: (n, label) => dec(rt, n, here, labelSeg(label), depth + 1),
      };
      return codec.deserialize(payload, ctx, meta);
    } catch (err) {
      throw asSerdeError(err, codec.name, format(here), "deserialize");
    }
  }

  return decPlain(rt, obj, here);
}

function decPlain(
  rt: Runtime,
  obj: Record<string, JsonValue>,
  here: PathNode,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    safeAssign(out, k, dec(rt, v, here, propSeg(k), here.depth + 1));
  }
  return out;
}
