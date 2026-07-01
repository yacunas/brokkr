/**
 * Typed errors the vault raises. All extend {@link MongoVaultError}, so importers
 * can catch that one type and branch on `.code`. Raw Mongo driver errors are
 * translated by {@link wrapMongoError} so callers never handle numeric codes.
 */
export class MongoVaultError extends Error {
  /** Stable, machine-readable discriminant. */
  readonly code: string = "MONGO_VAULT_ERROR";
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A unique index was violated (Mongo error 11000). */
export class DuplicateKeyError extends MongoVaultError {
  override readonly code = "DUPLICATE_KEY";
  constructor(
    message: string,
    /** The conflicting `{ field: value }` pairs, when the driver reports them. */
    readonly keyValue?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

/** A concurrent write conflict (Mongo error 112) — typically safe to retry. */
export class WriteConflictError extends MongoVaultError {
  override readonly code = "WRITE_CONFLICT";
}

/** A document failed schema validation, or a value couldn't be cast to its field. */
export class ValidationError extends MongoVaultError {
  override readonly code = "VALIDATION";
  constructor(
    message: string,
    /** Per-field validation messages, when available. */
    readonly fields?: Record<string, string>,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

/** A pagination cursor could not be decoded (tampered, truncated, or foreign). */
export class InvalidCursorError extends MongoVaultError {
  override readonly code = "INVALID_CURSOR";
}

/** Shape of the fields we read off a raw Mongo/Mongoose error. */
interface RawMongoError {
  code?: number;
  name?: string;
  message?: string;
  keyValue?: Record<string, unknown>;
  errors?: Record<string, { message?: string }>;
}

/**
 * Translate a raw Mongo/Mongoose error into a typed {@link MongoVaultError}.
 * Already-typed vault errors pass through unchanged.
 */
export function wrapMongoError(err: unknown): MongoVaultError {
  if (err instanceof MongoVaultError) return err;

  const e = (err ?? {}) as RawMongoError;
  const message = e.message ?? "MongoDB operation failed";

  if (e.code === 11000) {
    return new DuplicateKeyError(
      `Duplicate key${e.keyValue ? `: ${JSON.stringify(e.keyValue)}` : ""}`,
      e.keyValue,
      err,
    );
  }
  if (e.code === 112) {
    return new WriteConflictError("Write conflict — the operation should be retried", err);
  }
  if (e.name === "ValidationError") {
    const fields = e.errors
      ? Object.fromEntries(
          Object.entries(e.errors).map(([field, detail]) => [field, detail?.message ?? "invalid"]),
        )
      : undefined;
    return new ValidationError(message, fields, err);
  }
  if (e.name === "CastError") {
    return new ValidationError(message, undefined, err);
  }
  return new MongoVaultError(message, err);
}
