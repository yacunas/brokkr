/**
 * Thrown by {@link Ability.assert} when a subject is denied an action.
 *
 * Carries the attempted `action` and `resource` so callers can surface a
 * meaningful message or map it to an HTTP 403 without re-deriving context.
 */
export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";

  constructor(
    readonly action: string,
    readonly resource: string,
  ) {
    super(`Forbidden — not allowed to "${action}" on "${resource}"`);
    this.name = "ForbiddenError";
  }
}
