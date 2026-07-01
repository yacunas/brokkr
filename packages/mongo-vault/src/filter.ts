import type { FilterQuery } from "mongoose";
import type { IdAdapter } from "./id-adapter";
import type { Where } from "./types";

/** Maps our intent-based operators to Mongo query operators. */
const OPERATOR_MAP: Record<string, string> = {
  eq: "$eq",
  ne: "$ne",
  in: "$in",
  nin: "$nin",
  gt: "$gt",
  gte: "$gte",
  lt: "$lt",
  lte: "$lte",
  exists: "$exists",
};

const OPERATOR_KEYS = new Set<string>([...Object.keys(OPERATOR_MAP), "contains", "regex"]);

/** A plain object whose keys are *all* operator names — i.e. a `FilterOperators`. */
function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => OPERATOR_KEYS.has(key));
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Translate a database-agnostic {@link Where} into a Mongoose `FilterQuery`. The
 * `id` field is remapped to `_id` and its values pass through the id adapter, so
 * callers never see storage details.
 */
export function translateWhere<ID>(
  where: Where<Record<string, unknown>> | undefined,
  id: IdAdapter<ID>,
): FilterQuery<Record<string, unknown>> {
  if (!where) return {};
  const query: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(where)) {
    if (key === "and") {
      query.$and = (raw as Where<Record<string, unknown>>[]).map((w) => translateWhere(w, id));
      continue;
    }
    if (key === "or") {
      query.$or = (raw as Where<Record<string, unknown>>[]).map((w) => translateWhere(w, id));
      continue;
    }
    query[key === "id" ? "_id" : key] = translateCondition(key, raw, id);
  }

  return query as FilterQuery<Record<string, unknown>>;
}

function translateCondition<ID>(field: string, raw: unknown, id: IdAdapter<ID>): unknown {
  const toStorage = (value: unknown): unknown =>
    field === "id" ? id.toStorage(value as ID) : value;

  if (!isOperatorObject(raw)) return toStorage(raw);

  const out: Record<string, unknown> = {};
  for (const [op, value] of Object.entries(raw)) {
    if (op === "contains") {
      out.$regex = escapeRegex(String(value));
      out.$options = "i";
      continue;
    }
    if (op === "regex") {
      out.$regex = String(value);
      continue;
    }
    const mongoOp = OPERATOR_MAP[op];
    if (!mongoOp) continue;
    if (op === "in" || op === "nin") out[mongoOp] = (value as unknown[]).map(toStorage);
    else if (op === "exists") out[mongoOp] = value;
    else out[mongoOp] = toStorage(value);
  }
  return out;
}
