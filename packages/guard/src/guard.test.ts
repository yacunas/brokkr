import { describe, expect, it } from "vitest";
import { defineAbilities, defineRbac, ForbiddenError } from "./index";

interface User {
  id: string;
  roles: ReadonlyArray<"admin" | "member">;
}

interface Doc {
  id: string;
  ownerId: string;
}

type Action = "read" | "write" | "delete";
type Resource = "doc" | "comment";

const alice: User = { id: "alice", roles: ["member"] };
const bob: User = { id: "bob", roles: ["member"] };
const root: User = { id: "root", roles: ["admin"] };

describe("defineAbilities — allow and default deny", () => {
  it("permits an explicit allow and denies everything else", () => {
    const ability = defineAbilities<User, Action, Resource>((rules) => {
      rules.can("read", "doc");
    });

    expect(ability.can(alice, "read", "doc")).toBe(true);
    // default-deny: unlisted action
    expect(ability.can(alice, "write", "doc")).toBe(false);
    // default-deny: unlisted resource
    expect(ability.can(alice, "read", "comment")).toBe(false);
  });

  it("cannot() is the negation of can()", () => {
    const ability = defineAbilities<User, Action, Resource>((rules) => {
      rules.can("read", "doc");
    });

    expect(ability.cannot(alice, "read", "doc")).toBe(false);
    expect(ability.cannot(alice, "write", "doc")).toBe(true);
  });
});

describe("cannot — explicit deny overrides allow", () => {
  it("denies even when a matching allow exists, regardless of order", () => {
    const ability = defineAbilities<User, Action, Resource>((rules) => {
      rules.can("*", "all");
      rules.cannot("delete", "doc");
    });

    expect(ability.can(alice, "read", "doc")).toBe(true);
    expect(ability.can(alice, "delete", "doc")).toBe(false);
  });

  it("deny wins even when the deny is declared before the allow", () => {
    const ability = defineAbilities<User, Action, Resource>((rules) => {
      rules.cannot("delete", "doc");
      rules.can("delete", "doc");
    });

    expect(ability.can(alice, "delete", "doc")).toBe(false);
  });
});

describe("ABAC — condition-based ownership", () => {
  const ability = defineAbilities<User, Action, Resource>((rules) => {
    rules.can("write", "doc", (user, doc: Doc) => doc.ownerId === user.id);
  });
  const aliceDoc: Doc = { id: "d1", ownerId: "alice" };

  it("allows the owner", () => {
    expect(ability.can(alice, "write", "doc", aliceDoc)).toBe(true);
  });

  it("denies a non-owner", () => {
    expect(ability.can(bob, "write", "doc", aliceDoc)).toBe(false);
  });

  it("denies when no instance is supplied to a conditioned rule", () => {
    expect(ability.can(alice, "write", "doc")).toBe(false);
  });
});

describe("wildcards", () => {
  it("action wildcard matches any action on the resource", () => {
    const ability = defineAbilities<User, Action, Resource>((rules) => {
      rules.can("*", "doc");
    });

    expect(ability.can(alice, "read", "doc")).toBe(true);
    expect(ability.can(alice, "delete", "doc")).toBe(true);
    expect(ability.can(alice, "read", "comment")).toBe(false);
  });

  it("resource wildcard matches any resource for the action", () => {
    const ability = defineAbilities<User, Action, Resource>((rules) => {
      rules.can("read", "all");
    });

    expect(ability.can(alice, "read", "doc")).toBe(true);
    expect(ability.can(alice, "read", "comment")).toBe(true);
    expect(ability.can(alice, "write", "doc")).toBe(false);
  });
});

describe("defineRbac — abilities from roles", () => {
  const ability = defineRbac<User, "admin" | "member", Action, Resource>({
    roles: {
      admin: [{ action: "*", resource: "all" }],
      member: [{ action: "read", resource: ["doc", "comment"] }],
    },
    subjectRoles: (user) => user.roles,
  });

  it("admin can manage everything", () => {
    expect(ability.can(root, "read", "doc")).toBe(true);
    expect(ability.can(root, "delete", "comment")).toBe(true);
  });

  it("member is limited to their grants", () => {
    expect(ability.can(alice, "read", "doc")).toBe(true);
    expect(ability.can(alice, "read", "comment")).toBe(true);
    expect(ability.can(alice, "write", "doc")).toBe(false);
    expect(ability.can(alice, "delete", "doc")).toBe(false);
  });

  it("reflects the subject's roles at check time", () => {
    const promoted: User = { id: "alice", roles: ["member", "admin"] };
    expect(ability.can(promoted, "delete", "doc")).toBe(true);
  });
});

describe("assert", () => {
  const ability = defineAbilities<User, Action, Resource>((rules) => {
    rules.can("read", "doc");
  });

  it("does nothing (returns undefined) when allowed", () => {
    expect(ability.assert(alice, "read", "doc")).toBeUndefined();
  });

  it("throws ForbiddenError when denied", () => {
    expect(() => ability.assert(alice, "write", "doc")).toThrow(ForbiddenError);
  });

  it("the thrown error carries action, resource, and code", () => {
    try {
      ability.assert(alice, "delete", "doc");
      expect.unreachable("assert should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      const forbidden = err as ForbiddenError;
      expect(forbidden.action).toBe("delete");
      expect(forbidden.resource).toBe("doc");
      expect(forbidden.code).toBe("FORBIDDEN");
    }
  });
});

describe("combining multiple rules — deny precedence resolves correctly", () => {
  interface Post {
    id: string;
    authorId: string;
    locked: boolean;
  }
  type PostAction = "read" | "edit";

  const ability = defineAbilities<User, PostAction, "post">((rules) => {
    rules.can("read", "post");
    rules.can("edit", "post", (user, post: Post) => post.authorId === user.id);
    // even the author cannot edit a locked post
    rules.cannot("edit", "post", (_user, post: Post) => post.locked);
  });

  const open: Post = { id: "p1", authorId: "alice", locked: false };
  const locked: Post = { id: "p2", authorId: "alice", locked: true };

  it("author may edit an open post", () => {
    expect(ability.can(alice, "edit", "post", open)).toBe(true);
  });

  it("non-author may read but not edit", () => {
    expect(ability.can(bob, "read", "post", open)).toBe(true);
    expect(ability.can(bob, "edit", "post", open)).toBe(false);
  });

  it("conditional deny overrides the ownership allow for a locked post", () => {
    expect(ability.can(alice, "edit", "post", locked)).toBe(false);
    // reading is unaffected by the edit deny
    expect(ability.can(alice, "read", "post", locked)).toBe(true);
  });
});
