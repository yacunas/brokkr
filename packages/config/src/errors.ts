/**
 * A single validation problem discovered while loading configuration.
 */
export interface ConfigIssue {
  /** The schema key (typically the environment variable name) that failed. */
  readonly key: string;
  /** A human-readable explanation of what went wrong for this key. */
  readonly message: string;
}

/**
 * Thrown by {@link loadConfig} when one or more fields fail to load.
 *
 * The error is thrown only after the *entire* schema has been evaluated, so
 * {@link ConfigError.issues} contains every problem at once rather than just
 * the first one encountered. The {@link Error.message} is a readable
 * multi-line summary of all issues.
 */
export class ConfigError extends Error {
  /** Every validation problem found, in schema-declaration order. */
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.key}: ${issue.message}`).join("\n");
    super(`Configuration validation failed with ${issues.length} issue(s):\n${lines}`);
    this.name = "ConfigError";
    this.issues = issues;
    // Restore the prototype chain for correct `instanceof` after transpilation
    // to ES5-style class emit.
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}
