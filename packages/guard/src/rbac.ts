import { type ActionInput, type ResourceInput, Ability, defineAbilities } from "./guard";

/**
 * A single permission grant within a role: which action(s) on which resource(s).
 * Accepts wildcards (`"*"` / `"all"`) and arrays, just like the rule builder.
 *
 * @typeParam A - the union of allowed action strings
 * @typeParam R - the union of allowed resource tags
 */
export interface RbacGrant<A extends string, R extends string> {
  readonly action: ActionInput<A>;
  readonly resource: ResourceInput<R>;
}

/**
 * Declarative RBAC configuration: a map of role → grants, plus a function that
 * resolves the roles held by a given subject at check time.
 *
 * @typeParam S - the subject (actor) type
 * @typeParam Role - the union of role names
 * @typeParam A - the union of allowed action strings
 * @typeParam R - the union of allowed resource tags
 */
export interface RbacConfig<
  S,
  Role extends string,
  A extends string = string,
  R extends string = string,
> {
  /** Grants keyed by role name. Use `{ action: "*", resource: "all" }` for a super-role. */
  readonly roles: Record<Role, ReadonlyArray<RbacGrant<A, R>>>;
  /** Resolve the roles a subject currently holds (evaluated per check). */
  readonly subjectRoles: (subject: S) => ReadonlyArray<Role>;
}

/**
 * Build an {@link Ability} from a role → grants map.
 *
 * Each grant becomes an allow rule guarded by a condition that checks whether
 * the subject holds the owning role via `subjectRoles`. Because roles are
 * resolved at check time, a subject gaining or losing a role is reflected
 * immediately without rebuilding the ability.
 *
 * @typeParam S - the subject (actor) type
 * @typeParam Role - the union of role names
 * @typeParam A - the union of allowed action strings
 * @typeParam R - the union of allowed resource tags
 *
 * @example
 * type Role = "admin" | "member";
 * const ability = defineRbac<User, Role, "read" | "write", "post">({
 *   roles: {
 *     admin: [{ action: "*", resource: "all" }],
 *     member: [{ action: "read", resource: "post" }],
 *   },
 *   subjectRoles: (user) => user.roles,
 * });
 */
export function defineRbac<
  S,
  Role extends string,
  A extends string = string,
  R extends string = string,
>(config: RbacConfig<S, Role, A, R>): Ability<S, A, R> {
  const roleNames = Object.keys(config.roles) as Role[];
  return defineAbilities<S, A, R>((rules) => {
    for (const role of roleNames) {
      const hasRole = (subject: S): boolean => config.subjectRoles(subject).includes(role);
      for (const grant of config.roles[role]) {
        rules.can(grant.action, grant.resource, hasRole);
      }
    }
  });
}
