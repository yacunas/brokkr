import { ForbiddenError } from "./errors";

/**
 * Wildcard action that matches every action in a rule. Use with {@link RuleBuilder.can}
 * / {@link RuleBuilder.cannot}, e.g. `can("*", "document")`.
 */
export const ANY_ACTION = "*" as const;

/**
 * Wildcard resource that matches every resource in a rule, e.g. `can("read", "all")`.
 */
export const ANY_RESOURCE = "all" as const;

/**
 * A predicate evaluated at check time for attribute-based access control (ABAC).
 *
 * Receives the acting `subject` and, when the caller passes one, the resource
 * `instance` being acted on. Returns `true` when the rule should apply.
 *
 * @typeParam S - the subject (actor) type
 * @typeParam I - the resource instance type the condition inspects
 *
 * @example
 * const isOwner: Condition<User, Doc> = (user, doc) => doc.ownerId === user.id;
 */
export type Condition<S, I = unknown> = (subject: S, instance: I) => boolean;

/**
 * A single normalized authorization rule. Produced internally by the builder;
 * you rarely construct these by hand.
 *
 * @internal
 */
export interface Rule<S> {
  /** Matched action, or {@link ANY_ACTION} (`"*"`) to match every action. */
  readonly action: string;
  /** Matched resource tag, or {@link ANY_RESOURCE} (`"all"`) to match every resource. */
  readonly resource: string;
  /** Optional ABAC predicate; when present the rule only applies if it returns `true`. */
  readonly condition?: Condition<S, unknown>;
  /** `true` for a `cannot` rule (explicit deny), `false` for a `can` rule (allow). */
  readonly inverted: boolean;
}

/** One action or an array of actions accepted by the builder. */
export type ActionInput<A extends string> = A | typeof ANY_ACTION | ReadonlyArray<A>;

/** One resource or an array of resources accepted by the builder. */
export type ResourceInput<R extends string> = R | typeof ANY_RESOURCE | ReadonlyArray<R>;

/**
 * The fluent API handed to {@link defineAbilities}. Call {@link RuleBuilder.can}
 * to allow and {@link RuleBuilder.cannot} to deny; deny rules always win.
 *
 * @typeParam S - the subject (actor) type
 * @typeParam A - the union of allowed action strings (checked at compile time)
 * @typeParam R - the union of allowed resource tags (checked at compile time)
 */
export interface RuleBuilder<S, A extends string = string, R extends string = string> {
  /**
   * Grant permission. Optionally scope it to instances matching `condition` (ABAC).
   *
   * @param action - an action, an array of actions, or `"*"` for any action
   * @param resource - a resource tag, an array of tags, or `"all"` for any resource
   * @param condition - optional predicate that must pass for the grant to apply
   */
  can<I = unknown>(
    action: ActionInput<A>,
    resource: ResourceInput<R>,
    condition?: Condition<S, I>,
  ): void;

  /**
   * Explicitly deny permission. A matching deny overrides any matching allow,
   * regardless of declaration order. Optionally scope the deny with `condition`.
   *
   * @param action - an action, an array of actions, or `"*"` for any action
   * @param resource - a resource tag, an array of tags, or `"all"` for any resource
   * @param condition - optional predicate that must pass for the deny to apply
   */
  cannot<I = unknown>(
    action: ActionInput<A>,
    resource: ResourceInput<R>,
    condition?: Condition<S, I>,
  ): void;
}

function toArray<T>(value: T | ReadonlyArray<T>): readonly T[] {
  return Array.isArray(value) ? value : [value as T];
}

/**
 * A compiled, immutable set of authorization rules. Evaluate access with
 * {@link Ability.can}, invert with {@link Ability.cannot}, or enforce with
 * {@link Ability.assert}.
 *
 * Evaluation is **default-deny**: access is granted only when at least one
 * matching `can` rule applies and no matching `cannot` rule applies.
 *
 * @typeParam S - the subject (actor) type
 * @typeParam A - the union of allowed action strings
 * @typeParam R - the union of allowed resource tags
 */
export class Ability<S, A extends string = string, R extends string = string> {
  constructor(private readonly rules: ReadonlyArray<Rule<S>>) {}

  /**
   * Resolve whether `subject` may perform `action` on `resource`.
   *
   * A rule matches when its action equals `action` (or is `"*"`), its resource
   * equals `resource` (or is `"all"`), and its condition — if any — returns
   * `true` for `(subject, instance)`. Any matching `cannot` forces `false`
   * (deny precedence); otherwise `true` iff at least one `can` matched.
   *
   * @param instance - the concrete resource object passed to conditions; omit for pure RBAC
   * @returns `true` if allowed, `false` otherwise
   */
  can<I = unknown>(subject: S, action: A, resource: R, instance?: I): boolean {
    let allowed = false;
    for (const rule of this.rules) {
      if (rule.action !== ANY_ACTION && rule.action !== action) continue;
      if (rule.resource !== ANY_RESOURCE && rule.resource !== resource) continue;
      // Evaluate the rule's condition (if any). ABAC conditions inspect the
      // instance and will throw when it's absent — treat that as "no match"
      // (deny) rather than propagating. RBAC conditions inspect only the subject.
      if (rule.condition) {
        let matched = false;
        try {
          matched = rule.condition(subject, instance as never);
        } catch {
          matched = false;
        }
        if (!matched) continue;
      }
      if (rule.inverted) return false;
      allowed = true;
    }
    return allowed;
  }

  /**
   * Negation of {@link Ability.can} — `true` when the subject is **not** allowed.
   */
  cannot<I = unknown>(subject: S, action: A, resource: R, instance?: I): boolean {
    return !this.can(subject, action, resource, instance);
  }

  /**
   * Enforce access, throwing {@link ForbiddenError} when denied.
   *
   * @throws {ForbiddenError} if {@link Ability.can} would return `false`
   */
  assert<I = unknown>(subject: S, action: A, resource: R, instance?: I): void {
    if (!this.can(subject, action, resource, instance)) {
      throw new ForbiddenError(action, resource);
    }
  }
}

/**
 * Build an {@link Ability} from a declarative rule block.
 *
 * The builder callback receives an object with `can` / `cannot`; every call
 * appends a rule. Deny (`cannot`) rules always override matching allows.
 *
 * @typeParam S - the subject (actor) type
 * @typeParam A - the union of allowed action strings
 * @typeParam R - the union of allowed resource tags
 *
 * @example
 * type Action = "read" | "write" | "delete";
 * type Resource = "post" | "comment";
 * const ability = defineAbilities<User, Action, Resource>((rules) => {
 *   rules.can("read", "all");
 *   rules.can("write", "post", (user, post: Post) => post.authorId === user.id);
 *   rules.cannot("delete", "post");
 * });
 * ability.can(user, "read", "comment"); // true
 */
export function defineAbilities<S, A extends string = string, R extends string = string>(
  build: (rules: RuleBuilder<S, A, R>) => void,
): Ability<S, A, R> {
  const rules: Array<Rule<S>> = [];

  const push = (
    action: ActionInput<A>,
    resource: ResourceInput<R>,
    condition: Condition<S, unknown> | undefined,
    inverted: boolean,
  ): void => {
    for (const a of toArray(action)) {
      for (const r of toArray(resource)) {
        rules.push({ action: a, resource: r, condition, inverted });
      }
    }
  };

  const builder: RuleBuilder<S, A, R> = {
    can(action, resource, condition) {
      push(action, resource, condition as Condition<S, unknown> | undefined, false);
    },
    cannot(action, resource, condition) {
      push(action, resource, condition as Condition<S, unknown> | undefined, true);
    },
  };

  build(builder);
  return new Ability<S, A, R>(rules);
}
