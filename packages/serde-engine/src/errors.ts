/** Which half of the round-trip an error occurred in. */
export type SerdePhase = "serialize" | "deserialize";

/**
 * Base class for every error thrown by the engine. Importers can catch this one
 * type and branch on {@link SerdeError.code} for programmatic handling, and read
 * {@link SerdeError.path} to see exactly where in the structure things failed.
 *
 * @example
 * import { SerdeError } from "@brokkr/serde-engine";
 * try { serde.serialize(value); }
 * catch (err) {
 *   if (err instanceof SerdeError) {
 *     console.error(`${err.code} at ${err.path}: ${err.message}`);
 *   }
 * }
 */
export class SerdeError extends Error {
  /** Stable, machine-readable discriminant (e.g. `"UNKNOWN_TYPE"`). */
  readonly code: string = "SERDE_ERROR";
  /** Location of the offending value, e.g. `$.users[3].balance`. */
  readonly path?: string;
  /** Whether this happened while serializing or deserializing. */
  readonly phase?: SerdePhase;

  constructor(
    message: string,
    info: { path?: string; phase?: SerdePhase } = {},
    options?: { cause?: unknown },
  ) {
    super(info.path ? `${message} (at ${info.path})` : message, options);
    this.name = new.target.name;
    this.path = info.path;
    this.phase = info.phase;
  }
}

/** A value whose type can never be represented in JSON (`symbol`, `function`). */
export class UnsupportedTypeError extends SerdeError {
  override readonly code = "UNSUPPORTED_TYPE";
  constructor(
    readonly valueType: string,
    path: string,
  ) {
    super(`Cannot serialize a value of type "${valueType}"`, { path, phase: "serialize" });
  }
}

/** A class instance was encountered for which no codec is registered. */
export class UnknownTypeError extends SerdeError {
  override readonly code = "UNKNOWN_TYPE";
  constructor(
    readonly typeName: string,
    path: string,
  ) {
    super(
      `No codec registered for values of type "${typeName}" — register one with serde.register(...)`,
      { path, phase: "serialize" },
    );
  }
}

/** A payload references a tag no registered codec claims (usually a missing codec). */
export class UnknownTagError extends SerdeError {
  override readonly code = "UNKNOWN_TAG";
  constructor(
    readonly tag: string,
    path: string,
  ) {
    super(`No codec registered for tag "${tag}" — register the codec that produced this payload`, {
      path,
      phase: "deserialize",
    });
  }
}

/** A structure contains a reference back into one of its own ancestors. */
export class CircularReferenceError extends SerdeError {
  override readonly code = "CIRCULAR_REFERENCE";
  constructor(path: string) {
    super("Circular reference detected", { path, phase: "serialize" });
  }
}

/** Nesting exceeded the configured `maxDepth`. */
export class MaxDepthError extends SerdeError {
  override readonly code = "MAX_DEPTH_EXCEEDED";
  constructor(
    readonly maxDepth: number,
    path: string,
    phase: SerdePhase,
  ) {
    super(`Maximum nesting depth of ${maxDepth} exceeded`, { path, phase });
  }
}

/** A registered codec threw while (de)serializing; the original error is `cause`. */
export class CodecError extends SerdeError {
  override readonly code = "CODEC_ERROR";
  constructor(
    readonly codecName: string,
    path: string,
    phase: SerdePhase,
    options: { cause?: unknown },
  ) {
    super(`Codec "${codecName}" failed while ${phase} the value`, { path, phase }, options);
  }
}
