/**
 * Resolve-info projection.
 *
 * {@link getRequestedFields} walks a {@link GraphQLResolveInfo} selection set
 * and returns the distinct field names a client actually asked for. This lets a
 * resolver translate a GraphQL query into a `@brokkr/mongo-vault` projection —
 * fetching only the columns the client selected — including descending through
 * a Relay connection's `edges.node` to project the node's own fields.
 *
 * The walker resolves `FragmentSpread` (via `info.fragments`) and
 * `InlineFragment`, skips the meta-field `__typename`, and returns only the
 * field names at the requested level (it does not recurse into the
 * sub-selections of the collected fields).
 */

import {
  Kind,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLResolveInfo,
  type SelectionNode,
  type SelectionSetNode,
} from "graphql";

/** Options for {@link getRequestedFields}. */
export interface GetRequestedFieldsOptions {
  /**
   * A dotted path to descend into before collecting field names, e.g.
   * `"edges.node"` to project the node fields of a Relay connection query.
   */
  path?: string;
}

type Fragments = Record<string, FragmentDefinitionNode>;

/**
 * Collect the leaf field names directly within a selection set, expanding
 * fragment spreads and inline fragments in place. Does not recurse into the
 * sub-selections of the collected fields.
 */
function collectFieldNames(
  selectionSet: SelectionSetNode,
  fragments: Fragments,
  into: Set<string>,
): void {
  for (const selection of selectionSet.selections) {
    switch (selection.kind) {
      case Kind.FIELD: {
        const name = selection.name.value;
        if (name !== "__typename") {
          into.add(name);
        }
        break;
      }
      case Kind.INLINE_FRAGMENT: {
        if (selection.selectionSet) {
          collectFieldNames(selection.selectionSet, fragments, into);
        }
        break;
      }
      case Kind.FRAGMENT_SPREAD: {
        const fragment = fragments[selection.name.value];
        if (fragment) {
          collectFieldNames(fragment.selectionSet, fragments, into);
        }
        break;
      }
    }
  }
}

/**
 * Find the first field named `name` within a selection set, expanding
 * fragments so the search sees through spreads and inline fragments.
 */
function findField(
  selectionSet: SelectionSetNode,
  name: string,
  fragments: Fragments,
): FieldNode | undefined {
  for (const selection of selectionSet.selections) {
    const found = matchSelection(selection, name, fragments);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function matchSelection(
  selection: SelectionNode,
  name: string,
  fragments: Fragments,
): FieldNode | undefined {
  switch (selection.kind) {
    case Kind.FIELD:
      return selection.name.value === name ? selection : undefined;
    case Kind.INLINE_FRAGMENT:
      return selection.selectionSet
        ? findField(selection.selectionSet, name, fragments)
        : undefined;
    case Kind.FRAGMENT_SPREAD: {
      const fragment = fragments[selection.name.value];
      return fragment ? findField(fragment.selectionSet, name, fragments) : undefined;
    }
  }
}

/**
 * Return the distinct field names selected on the field currently being
 * resolved.
 *
 * With `options.path` set (e.g. `"edges.node"`), the walker first descends
 * through those nested selection sets and then collects the leaf field names
 * at that level — ideal for turning a Relay connection query into a projection
 * of the node's fields.
 *
 * @example
 * // In a resolver:
 * const fields = getRequestedFields(info, { path: "edges.node" });
 * const page = await users.paginate(args, { projection: fields });
 *
 * @param info - The resolver's `GraphQLResolveInfo`.
 * @param options - Optional dotted `path` to descend before collecting.
 * @returns Distinct field names, in first-seen order, excluding `__typename`.
 */
export function getRequestedFields(
  info: GraphQLResolveInfo,
  options: GetRequestedFieldsOptions = {},
): string[] {
  const fragments = info.fragments as Fragments;

  // A field may appear multiple times across the operation (e.g. aliased or
  // duplicated); merge every node's selection set for the current field.
  let selectionSets: SelectionSetNode[] = [];
  for (const node of info.fieldNodes) {
    if (node.selectionSet) {
      selectionSets.push(node.selectionSet);
    }
  }

  const segments = options.path ? options.path.split(".").filter(Boolean) : [];
  for (const segment of segments) {
    const next: SelectionSetNode[] = [];
    for (const selectionSet of selectionSets) {
      const field = findField(selectionSet, segment, fragments);
      if (field?.selectionSet) {
        next.push(field.selectionSet);
      }
    }
    selectionSets = next;
    if (selectionSets.length === 0) {
      return [];
    }
  }

  const names = new Set<string>();
  for (const selectionSet of selectionSets) {
    collectFieldNames(selectionSet, fragments, names);
  }
  return [...names];
}
