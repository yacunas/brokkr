/**
 * @brokkr/guard
 *
 * Typed, framework-agnostic authorization with zero runtime dependencies:
 *
 * - **RBAC + ABAC** — {@link defineAbilities} declares allow (`can`) and deny
 *   (`cannot`) rules, optionally guarded by an ownership/attribute
 *   {@link Condition} evaluated against the subject and resource instance.
 * - **Default-deny with deny precedence** — {@link Ability.can} grants access
 *   only when a matching allow exists and no matching deny does.
 * - **Wildcards** — action `"*"` ({@link ANY_ACTION}) and resource `"all"`
 *   ({@link ANY_RESOURCE}) match everything.
 * - **Enforcement** — {@link Ability.assert} throws {@link ForbiddenError} when denied.
 * - **Roles** — {@link defineRbac} builds an ability from a role → grants map
 *   plus a subject → roles resolver.
 */

export {
  ANY_ACTION,
  ANY_RESOURCE,
  Ability,
  defineAbilities,
  type Condition,
  type Rule,
  type RuleBuilder,
  type ActionInput,
  type ResourceInput,
} from "./guard";
export { defineRbac, type RbacConfig, type RbacGrant } from "./rbac";
export { ForbiddenError } from "./errors";
