import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Schema, type Model } from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createMongoVault,
  DuplicateKeyError,
  InvalidCursorError,
  MongoVaultError,
  ValidationError,
  type CreateInput,
} from "./index";

interface Widget {
  id: string;
  name: string;
  price: number;
  active: boolean;
  tags: string[];
  createdAt: Date;
  category?: string;
}

interface Account {
  id: string;
  email: string;
}

const widgetSchema = new Schema(
  {
    name: { type: String, required: true },
    price: Number,
    active: Boolean,
    tags: [String],
    createdAt: Date,
    category: String,
  },
  { versionKey: "__v" },
);

const accountSchema = new Schema({ email: { type: String, unique: true } });

let mongod: MongoMemoryServer;
let WidgetModel: Model<any>;
let AccountModel: Model<any>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  WidgetModel = mongoose.model("Widget", widgetSchema);
  AccountModel = mongoose.model("Account", accountSchema);
  await AccountModel.init(); // build the unique index
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await WidgetModel.deleteMany({});
  await AccountModel.deleteMany({});
});

function widgets() {
  return createMongoVault<Widget>(WidgetModel);
}

function makeWidget(over: Partial<Widget> = {}): CreateInput<Widget> {
  return {
    name: over.name ?? "widget",
    price: over.price ?? 10,
    active: over.active ?? true,
    tags: over.tags ?? [],
    createdAt: over.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    ...(over.category ? { category: over.category } : {}),
    ...(over.id ? { id: over.id } : {}),
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("create & read (happy path)", () => {
  it("creates with a generated hex-string id and maps _id → id (no leaks)", async () => {
    const vault = widgets();
    const created = await vault.create(makeWidget({ name: "Ada" }));

    expect(typeof created.id).toBe("string");
    expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    expect(created.name).toBe("Ada");
    expect(created).not.toHaveProperty("_id");
    expect(created).not.toHaveProperty("__v");
  });

  it("honors an explicit id on create", async () => {
    const vault = widgets();
    const id = new mongoose.Types.ObjectId().toHexString();
    const created = await vault.create(makeWidget({ id }));
    expect(created.id).toBe(id);
    expect((await vault.findById(id))?.id).toBe(id);
  });

  it("findById returns the entity, or null when missing", async () => {
    const vault = widgets();
    const { id } = await vault.create(makeWidget());
    expect((await vault.findById(id))?.id).toBe(id);
    expect(await vault.findById(new mongoose.Types.ObjectId().toHexString())).toBeNull();
  });

  it("findOne matches by a typed filter", async () => {
    const vault = widgets();
    await vault.create(makeWidget({ name: "target", price: 99 }));
    const found = await vault.findOne({ name: "target" });
    expect(found?.price).toBe(99);
    expect(await vault.findOne({ name: "nope" })).toBeNull();
  });

  it("exists reflects presence", async () => {
    const vault = widgets();
    const { id } = await vault.create(makeWidget());
    expect(await vault.exists(id)).toBe(true);
    expect(await vault.exists(new mongoose.Types.ObjectId().toHexString())).toBe(false);
  });

  it("createMany inserts a batch", async () => {
    const vault = widgets();
    const created = await vault.createMany([
      makeWidget({ name: "a" }),
      makeWidget({ name: "b" }),
      makeWidget({ name: "c" }),
    ]);
    expect(created).toHaveLength(3);
    expect(await vault.count()).toBe(3);
  });
});

describe("filtering", () => {
  it("supports bare-value equality and comparison operators", async () => {
    const vault = widgets();
    await vault.createMany([
      makeWidget({ name: "cheap", price: 5 }),
      makeWidget({ name: "mid", price: 50 }),
      makeWidget({ name: "dear", price: 500 }),
    ]);

    expect(await vault.count({ price: 50 })).toBe(1); // bare = eq
    expect(await vault.count({ price: { gte: 50 } })).toBe(2);
    expect(await vault.count({ price: { gt: 5, lt: 500 } })).toBe(1);
    expect(await vault.count({ name: { in: ["cheap", "dear"] } })).toBe(2);
    expect(await vault.count({ price: { ne: 50 } })).toBe(2);
  });

  it("supports case-insensitive contains and escapes regex metacharacters", async () => {
    const vault = widgets();
    await vault.createMany([
      makeWidget({ name: "Alpha.One" }),
      makeWidget({ name: "alphaTwo" }),
      makeWidget({ name: "Beta" }),
    ]);
    expect(await vault.count({ name: { contains: "alpha" } })).toBe(2); // case-insensitive
    // The "." is a literal, not "any char" — so it must not match "alphaTwo".
    expect(await vault.count({ name: { contains: "a.o" } })).toBe(1);
  });

  it("composes and / or", async () => {
    const vault = widgets();
    await vault.createMany([
      makeWidget({ name: "a", price: 10, active: true }),
      makeWidget({ name: "b", price: 10, active: false }),
      makeWidget({ name: "c", price: 20, active: true }),
    ]);
    expect(await vault.count({ and: [{ price: 10 }, { active: true }] })).toBe(1);
    expect(await vault.count({ or: [{ price: 20 }, { active: false }] })).toBe(2);
  });
});

describe("sort, projection, update, delete", () => {
  it("sorts by a field", async () => {
    const vault = widgets();
    await vault.createMany([
      makeWidget({ name: "b", price: 2 }),
      makeWidget({ name: "a", price: 1 }),
      makeWidget({ name: "c", price: 3 }),
    ]);
    const asc = await vault.find({ sort: [{ field: "price", direction: "asc" }] });
    expect(asc.map((w) => w.price)).toEqual([1, 2, 3]);
    const desc = await vault.find({ sort: [{ field: "price", direction: "desc" }] });
    expect(desc.map((w) => w.price)).toEqual([3, 2, 1]);
  });

  it("projects only requested fields (plus id)", async () => {
    const vault = widgets();
    await vault.create(makeWidget({ name: "x", price: 7, category: "tools" }));
    const [row] = await vault.find({ projection: ["name", "price"] });
    expect(row?.id).toBeDefined();
    expect(row?.name).toBe("x");
    expect(row?.price).toBe(7);
    expect(row).not.toHaveProperty("category");
    expect(row).not.toHaveProperty("active");
  });

  it("updates a patch and returns the new entity; null when missing", async () => {
    const vault = widgets();
    const { id } = await vault.create(makeWidget({ price: 1 }));
    const updated = await vault.update(id, { price: 999 });
    expect(updated?.price).toBe(999);
    expect(await vault.update(new mongoose.Types.ObjectId().toHexString(), { price: 1 })).toBeNull();
  });

  it("deletes and reports whether a document was removed", async () => {
    const vault = widgets();
    const { id } = await vault.create(makeWidget());
    expect(await vault.delete(id)).toBe(true);
    expect(await vault.delete(id)).toBe(false);
    expect(await vault.findById(id)).toBeNull();
  });

  it("runs a raw aggregate escape hatch", async () => {
    const vault = widgets();
    await vault.createMany([makeWidget({ price: 10 }), makeWidget({ price: 30 })]);
    const rows = await vault.aggregate<{ _id: null; total: number }>([
      { $group: { _id: null, total: { $sum: "$price" } } },
    ]);
    expect(rows[0]?.total).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------

describe("cursor pagination", () => {
  async function seed(vault = widgets(), count = 25) {
    const inputs = Array.from({ length: count }, (_, i) =>
      makeWidget({
        name: `w${String(i).padStart(2, "0")}`,
        price: i,
        createdAt: new Date(2026, 0, 1, 0, 0, i),
      }),
    );
    await vault.createMany(inputs);
    return vault;
  }

  it("walks every item exactly once, forward, in sort order", async () => {
    const vault = await seed();
    const seen: number[] = [];
    let after: string | undefined;
    let guard = 0;
    for (;;) {
      const page = await vault.paginate(
        { first: 10, after },
        { sort: [{ field: "price", direction: "asc" }] },
      );
      seen.push(...page.edges.map((e) => e.node.price));
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor ?? undefined;
      if (++guard > 10) throw new Error("pagination did not terminate");
    }
    expect(seen).toEqual([...Array(25).keys()]); // 0..24, in order, no dupes/skips
  });

  it("paginates backward with last/before", async () => {
    const vault = await seed(widgets(), 10);
    const firstPage = await vault.paginate(
      { first: 5 },
      { sort: [{ field: "price", direction: "asc" }] },
    );
    expect(firstPage.edges.map((e) => e.node.price)).toEqual([0, 1, 2, 3, 4]);

    const back = await vault.paginate(
      { last: 3, before: firstPage.pageInfo.endCursor! },
      { sort: [{ field: "price", direction: "asc" }] },
    );
    // Items strictly before price=4, last 3 of them → 1,2,3 (ascending)
    expect(back.edges.map((e) => e.node.price)).toEqual([1, 2, 3]);
    expect(back.pageInfo.hasNextPage).toBe(true);
  });

  it("stays stable when the sort field has ties (tie-break by id)", async () => {
    const vault = widgets();
    // All identical price → ordering must fall back to the _id tiebreaker.
    await vault.createMany(Array.from({ length: 12 }, () => makeWidget({ price: 7 })));

    const seen = new Set<string>();
    let after: string | undefined;
    for (;;) {
      const page = await vault.paginate(
        { first: 5, after },
        { sort: [{ field: "price", direction: "asc" }] },
      );
      for (const edge of page.edges) seen.add(edge.node.id);
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor ?? undefined;
    }
    expect(seen.size).toBe(12); // every id seen once, none skipped or duplicated
  });

  it("returns totalCount when asked, and applies the filter to it", async () => {
    const vault = await seed(widgets(), 20);
    const page = await vault.paginate({ first: 5 }, { where: { price: { gte: 10 } }, totalCount: true });
    expect(page.edges).toHaveLength(5);
    expect(page.totalCount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("returns a well-formed empty connection for no matches", async () => {
    const page = await widgets().paginate({ first: 10 });
    expect(page.edges).toEqual([]);
    expect(page.pageInfo).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
  });

  it("paginates correctly even when the projection omits the sort field", async () => {
    const vault = widgets();
    await vault.createMany(
      Array.from({ length: 6 }, (_, i) => makeWidget({ name: `n${i}`, price: i })),
    );
    // Ask only for `name`, but sort by `price` — the vault must still read price
    // internally to build the cursor.
    const page = await vault.paginate(
      { first: 3 },
      { projection: ["name"], sort: [{ field: "price", direction: "asc" }] },
    );
    expect(page.edges.map((e) => e.node.name)).toEqual(["n0", "n1", "n2"]);
    expect(page.edges[0]?.node).not.toHaveProperty("price"); // projection respected
    const next = await vault.paginate(
      { first: 3, after: page.pageInfo.endCursor! },
      { projection: ["name"], sort: [{ field: "price", direction: "asc" }] },
    );
    expect(next.edges.map((e) => e.node.name)).toEqual(["n3", "n4", "n5"]);
  });

  it("round-trips Date sort values through the cursor", async () => {
    const vault = widgets();
    await vault.createMany(
      Array.from({ length: 4 }, (_, i) =>
        makeWidget({ name: `d${i}`, createdAt: new Date(2026, 5, 1 + i) }),
      ),
    );
    const page = await vault.paginate(
      { first: 2 },
      { sort: [{ field: "createdAt", direction: "desc" }] },
    );
    const next = await vault.paginate(
      { first: 2, after: page.pageInfo.endCursor! },
      { sort: [{ field: "createdAt", direction: "desc" }] },
    );
    const order = [...page.edges, ...next.edges].map((e) => e.node.name);
    expect(order).toEqual(["d3", "d2", "d1", "d0"]);
  });

  it("clamps a non-positive page size to at least 1", async () => {
    const vault = widgets();
    await vault.createMany([makeWidget(), makeWidget()]);
    const page = await vault.paginate({ first: 0 });
    expect(page.edges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

describe("negative cases", () => {
  it("throws InvalidCursorError on a malformed cursor", async () => {
    const vault = widgets();
    await vault.create(makeWidget());
    await expect(vault.paginate({ first: 5, after: "!!!not-a-cursor!!!" })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it("throws DuplicateKeyError on a unique-index violation", async () => {
    const accounts = createMongoVault<Account>(AccountModel);
    await accounts.create({ email: "dup@example.com" });
    await expect(accounts.create({ email: "dup@example.com" })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it("throws ValidationError when a required field is missing", async () => {
    const vault = widgets();
    const bad = { price: 1, active: true, tags: [], createdAt: new Date() };
    await expect(vault.create(bad as unknown as CreateInput<Widget>)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("wraps a malformed id in a typed MongoVaultError", async () => {
    const vault = widgets();
    await expect(vault.findById("not-a-valid-object-id")).rejects.toBeInstanceOf(MongoVaultError);
  });
});
