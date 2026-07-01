# @brokkr/guard

> Typed authorization for TypeScript — RBAC + lightweight ABAC. Framework-agnostic, zero dependencies.

Declare who can do what with plain allow/deny rules. Access is **default-deny**,
deny rules always win, and actions/resources are checked against your own string
unions at compile time.

- **RBAC** — grant actions on resources per role.
- **ABAC** — attach a condition (e.g. an ownership check) to any rule.
- **Wildcards** — `"*"` matches any action, `"all"` matches any resource.
- **Enforce** — `assert()` throws a typed `ForbiddenError` when denied.

## Define abilities

```ts
import { defineAbilities } from "@brokkr/guard";

type Action = "read" | "write" | "delete";
type Resource = "doc" | "comment";

interface User {
  id: string;
}
interface Doc {
  ownerId: string;
}

const ability = defineAbilities<User, Action, Resource>((rules) => {
  rules.can("read", "all"); // anyone can read anything
  rules.can("write", "doc", (user, doc: Doc) => doc.ownerId === user.id); // owner-only
  rules.cannot("delete", "doc"); // explicit deny — overrides any allow
});

ability.can(user, "read", "comment"); // true (wildcard resource)
ability.can(user, "write", "doc", someDoc); // true only if user owns someDoc
ability.can(user, "delete", "doc"); // false (denied)
```

`can(subject, action, resource, instance?)` returns a boolean. `cannot(...)` is
its negation. The optional `instance` is the resource object passed to conditions
— omit it for pure role checks.

## Enforce with assert

```ts
import { ForbiddenError } from "@brokkr/guard";

try {
  ability.assert(user, "delete", "doc"); // throws when denied
} catch (err) {
  if (err instanceof ForbiddenError) {
    // err.action, err.resource, err.code === "FORBIDDEN"
    reply.code(403).send(err.message);
  }
}
```

## Roles (RBAC)

Build an ability from a role → grants map plus a subject → roles resolver. Roles
are resolved at check time, so a subject gaining or losing a role takes effect
immediately.

```ts
import { defineRbac } from "@brokkr/guard";

type Role = "admin" | "member";

const ability = defineRbac<User, Role, Action, Resource>({
  roles: {
    admin: [{ action: "*", resource: "all" }], // manage everything
    member: [{ action: "read", resource: ["doc", "comment"] }],
  },
  subjectRoles: (user) => user.roles,
});

ability.can(admin, "delete", "doc"); // true
ability.can(member, "write", "doc"); // false
```

## Resolution rules

1. Start from **deny**.
2. A rule matches when action matches (or is `"*"`), resource matches (or is
   `"all"`), and its condition — if any — returns `true`.
3. Any matching `cannot` forces `false`, regardless of declaration order.
4. Otherwise, allow iff at least one `can` matched.

## License

MIT © Yronnel James
