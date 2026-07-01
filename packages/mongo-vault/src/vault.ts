import type { FilterQuery, Model, PipelineStage, SortOrder } from "mongoose";
import { Serde } from "@brokkr/serde-engine";
import { InvalidCursorError, wrapMongoError } from "./errors";
import { translateWhere } from "./filter";
import { stringObjectIdAdapter, type IdAdapter } from "./id-adapter";
import type {
  Connection,
  ConnectionArgs,
  CreateInput,
  Edge,
  FindOptions,
  Identifiable,
  PaginateOptions,
  Projection,
  Sort,
  Where,
} from "./types";

/**
 * The abstraction: a fully-typed, database-agnostic data-access surface. Program
 * your services against this — `find`, `paginate`, `create`, … expose *what* they
 * do, never *how*. {@link MongoVault} is the Mongoose implementation; a different
 * engine could implement the same class without any service change.
 *
 * Engine-specific escape hatches (e.g. `aggregate`) live on the concrete class,
 * not here, so this contract stays clean.
 */
export abstract class Vault<T extends Identifiable<ID>, ID = string> {
  abstract findById(id: ID, projection?: Projection<T>): Promise<T | null>;
  abstract findOne(where: Where<T>, projection?: Projection<T>): Promise<T | null>;
  abstract find(options?: FindOptions<T>): Promise<T[]>;
  abstract paginate(args: ConnectionArgs, options?: PaginateOptions<T>): Promise<Connection<T>>;
  abstract count(where?: Where<T>): Promise<number>;
  abstract create(input: CreateInput<T, ID>): Promise<T>;
  abstract createMany(inputs: ReadonlyArray<CreateInput<T, ID>>): Promise<T[]>;
  abstract update(id: ID, patch: Partial<Omit<T, "id">>): Promise<T | null>;
  abstract delete(id: ID): Promise<boolean>;

  /** Convenience built on {@link Vault.findById}. */
  async exists(id: ID): Promise<boolean> {
    return (await this.findById(id)) !== null;
  }
}

export interface MongoVaultOptions<T extends Identifiable<ID>, ID = string> {
  /** Identity strategy. Defaults to hex-string ids stored as native ObjectId. */
  id?: IdAdapter<ID>;
  /** Override the raw-document → entity mapping (default maps `_id`→`id`, drops `__v`). */
  toEntity?: (doc: Record<string, unknown>) => T;
}

/** Normalized, storage-aware sort key used internally for pagination. */
interface NormalizedSort {
  field: string; // domain field name (e.g. "id")
  storageField: string; // stored field name (e.g. "_id")
  direction: 1 | -1;
}

/** A Mongoose-backed {@link Vault}. */
export class MongoVault<T extends Identifiable<ID>, ID = string> extends Vault<T, ID> {
  private readonly model: Model<any>;
  private readonly ids: IdAdapter<ID>;
  private readonly cursors: Serde;
  private readonly toEntity: (doc: Record<string, unknown>) => T;

  constructor(model: Model<any>, options: MongoVaultOptions<T, ID> = {}) {
    super();
    this.model = model;
    this.ids = options.id ?? (stringObjectIdAdapter as unknown as IdAdapter<ID>);
    this.cursors = new Serde({ codecs: this.ids.codec ? [this.ids.codec] : [] });
    this.toEntity = options.toEntity ?? ((doc) => this.mapEntity(doc));
  }

  // -- reads -----------------------------------------------------------------

  findById(id: ID, projection?: Projection<T>): Promise<T | null> {
    return this.guard(async () => {
      const doc = await this.model
        .findById(this.ids.toStorage(id), this.buildProjection(projection))
        .lean()
        .exec();
      return doc ? this.toEntity(doc as Record<string, unknown>) : null;
    });
  }

  findOne(where: Where<T>, projection?: Projection<T>): Promise<T | null> {
    return this.guard(async () => {
      const doc = await this.model
        .findOne(this.where(where), this.buildProjection(projection))
        .lean()
        .exec();
      return doc ? this.toEntity(doc as Record<string, unknown>) : null;
    });
  }

  find(options: FindOptions<T> = {}): Promise<T[]> {
    return this.guard(async () => {
      const query = this.model.find(
        this.where(options.where),
        this.buildProjection(options.projection),
      );
      if (options.sort?.length) query.sort(this.mongoSort(this.normalizeSort(options.sort)));
      if (options.limit != null) query.limit(options.limit);
      const docs = (await query.lean().exec()) as Record<string, unknown>[];
      return docs.map((doc) => this.toEntity(doc));
    });
  }

  count(where?: Where<T>): Promise<number> {
    return this.guard(() => this.model.countDocuments(this.where(where)).exec());
  }

  paginate(args: ConnectionArgs, options: PaginateOptions<T> = {}): Promise<Connection<T>> {
    return this.guard(async () => {
      const backward = args.last != null || args.before != null;
      const limit = Math.max(1, (backward ? args.last : args.first) ?? 20);
      const cursorArg = backward ? args.before : args.after;

      const baseSort = this.normalizeSort(options.sort);
      const querySort = backward ? this.reverseSort(baseSort) : baseSort;

      const conditions: FilterQuery<Record<string, unknown>>[] = [this.where(options.where)];
      if (cursorArg) conditions.push(this.keysetCondition(this.decodeCursor(cursorArg), querySort));
      const finalQuery: FilterQuery<Record<string, unknown>> =
        conditions.length > 1 ? { $and: conditions } : conditions[0]!;

      // Sort fields must be fetched to build the cursor even if the caller's
      // projection omits them — but they must not leak into the returned node.
      const ensure = baseSort.map((s) => s.storageField);
      const stripFields = options.projection
        ? baseSort
            .map((s) => s.field)
            .filter((field) => field !== "id" && !options.projection!.includes(field as never))
        : [];

      const docs = (await this.model
        .find(finalQuery, this.buildProjection(options.projection, ensure))
        .sort(this.mongoSort(querySort))
        .limit(limit + 1)
        .lean()
        .exec()) as Record<string, unknown>[];

      const hasExtra = docs.length > limit;
      let pageDocs = hasExtra ? docs.slice(0, limit) : docs;
      if (backward) pageDocs = pageDocs.reverse();

      const edges: Edge<T>[] = pageDocs.map((doc) => {
        const cursor = this.encodeCursor(doc, baseSort);
        const node = this.toEntity(doc);
        for (const field of stripFields) delete (node as Record<string, unknown>)[field];
        return { node, cursor };
      });

      const connection: Connection<T> = {
        edges,
        pageInfo: {
          hasNextPage: backward ? Boolean(args.before) : hasExtra,
          hasPreviousPage: backward ? hasExtra : Boolean(args.after),
          startCursor: edges.length ? edges[0]!.cursor : null,
          endCursor: edges.length ? edges[edges.length - 1]!.cursor : null,
        },
      };
      if (options.totalCount) connection.totalCount = await this.count(options.where);
      return connection;
    });
  }

  /**
   * Escape hatch: run a raw Mongo aggregation pipeline. This intentionally exposes
   * Mongo (`PipelineStage`) — reserve it for engine-specific needs the typed API
   * can't express. Results are returned as-is, not mapped through the entity mapper.
   */
  aggregate<R = Record<string, unknown>>(pipeline: PipelineStage[]): Promise<R[]> {
    return this.guard(() => this.model.aggregate<R>(pipeline).exec());
  }

  // -- writes ----------------------------------------------------------------

  create(input: CreateInput<T, ID>): Promise<T> {
    return this.guard(async () => {
      const created = await this.model.create(this.toDocument(input));
      return this.toEntity(created.toObject() as Record<string, unknown>);
    });
  }

  createMany(inputs: ReadonlyArray<CreateInput<T, ID>>): Promise<T[]> {
    return this.guard(async () => {
      const created = await this.model.insertMany(inputs.map((input) => this.toDocument(input)));
      return created.map((doc: { toObject(): Record<string, unknown> }) =>
        this.toEntity(doc.toObject()),
      );
    });
  }

  update(id: ID, patch: Partial<Omit<T, "id">>): Promise<T | null> {
    return this.guard(async () => {
      const doc = await this.model
        .findByIdAndUpdate(this.ids.toStorage(id), { $set: patch }, { new: true })
        .lean()
        .exec();
      return doc ? this.toEntity(doc as Record<string, unknown>) : null;
    });
  }

  delete(id: ID): Promise<boolean> {
    return this.guard(async () => {
      const res = await this.model.findByIdAndDelete(this.ids.toStorage(id)).lean().exec();
      return res != null;
    });
  }

  // -- internals -------------------------------------------------------------

  /** Run a DB operation, translating any raw Mongo error into a typed vault error. */
  private async guard<R>(operation: () => Promise<R>): Promise<R> {
    try {
      return await operation();
    } catch (err) {
      throw wrapMongoError(err);
    }
  }

  private where(where?: Where<T>): FilterQuery<Record<string, unknown>> {
    return translateWhere(where as Where<Record<string, unknown>> | undefined, this.ids);
  }

  private mapEntity(doc: Record<string, unknown>): T {
    const { _id, __v, ...rest } = doc;
    void __v;
    return { id: this.ids.fromStorage(_id), ...rest } as T;
  }

  private toDocument(input: CreateInput<T, ID>): Record<string, unknown> {
    const { id, ...rest } = input as Record<string, unknown> & { id?: ID };
    return { _id: this.ids.toStorage(id ?? this.ids.generate()), ...rest };
  }

  private buildProjection(
    projection?: Projection<T>,
    ensure?: readonly string[],
  ): Record<string, 1> | undefined {
    if (!projection || projection.length === 0) return undefined; // whole entity
    const out: Record<string, 1> = { _id: 1 };
    for (const field of projection) out[field === "id" ? "_id" : field] = 1;
    for (const field of ensure ?? []) out[field] = 1;
    return out;
  }

  private normalizeSort(sort?: Sort<T>): NormalizedSort[] {
    const out: NormalizedSort[] = [];
    const seen = new Set<string>();
    for (const { field, direction } of sort ?? []) {
      const storageField = field === "id" ? "_id" : field;
      out.push({ field, storageField, direction: direction === "asc" ? 1 : -1 });
      seen.add(storageField);
    }
    // Always end on a unique key so the ordering is total → cursors are stable.
    if (!seen.has("_id")) out.push({ field: "id", storageField: "_id", direction: 1 });
    return out;
  }

  private reverseSort(sort: NormalizedSort[]): NormalizedSort[] {
    return sort.map((s) => ({ ...s, direction: (s.direction === 1 ? -1 : 1) as 1 | -1 }));
  }

  private mongoSort(sort: NormalizedSort[]): Record<string, SortOrder> {
    const out: Record<string, SortOrder> = {};
    for (const s of sort) out[s.storageField] = s.direction;
    return out;
  }

  /** Lexicographic "after the cursor tuple" predicate — the keyset seek. */
  private keysetCondition(
    cursor: Record<string, unknown>,
    sort: NormalizedSort[],
  ): FilterQuery<Record<string, unknown>> {
    const branches: Record<string, unknown>[] = [];
    for (let i = 0; i < sort.length; i++) {
      const branch: Record<string, unknown> = {};
      for (let j = 0; j < i; j++) {
        const prior = sort[j]!;
        branch[prior.storageField] = this.cursorToStorage(prior, cursor[prior.field]);
      }
      const current = sort[i]!;
      const op = current.direction === 1 ? "$gt" : "$lt";
      branch[current.storageField] = { [op]: this.cursorToStorage(current, cursor[current.field]) };
      branches.push(branch);
    }
    return { $or: branches } as FilterQuery<Record<string, unknown>>;
  }

  private cursorToStorage(sort: NormalizedSort, value: unknown): unknown {
    return sort.field === "id" ? this.ids.toStorage(value as ID) : value;
  }

  private encodeCursor(doc: Record<string, unknown>, sort: NormalizedSort[]): string {
    const payload: Record<string, unknown> = {};
    for (const s of sort) {
      payload[s.field] = s.field === "id" ? this.ids.fromStorage(doc._id) : doc[s.storageField];
    }
    return Buffer.from(this.cursors.serialize(payload)).toString("base64url");
  }

  private decodeCursor(cursor: string): Record<string, unknown> {
    try {
      const json = Buffer.from(cursor, "base64url").toString("utf8");
      return this.cursors.deserialize(json) as Record<string, unknown>;
    } catch (err) {
      throw new InvalidCursorError("Invalid pagination cursor", err);
    }
  }
}

/** Build a {@link MongoVault} over a Mongoose model. */
export function createMongoVault<T extends Identifiable<ID>, ID = string>(
  model: Model<any>,
  options?: MongoVaultOptions<T, ID>,
): MongoVault<T, ID> {
  return new MongoVault<T, ID>(model, options);
}
