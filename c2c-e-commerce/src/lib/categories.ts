// ─── Category path arithmetic ─────────────────────────────────────────────────
// Part 1 of the 2026-08-30 redesign. Every rule the tree depends on lives here, and
// nothing here touches the database — the route layer and the browser both import it,
// and the rules are worth proving without a container.
//
// A `path` is the dot-separated chain of ancestor ids including the node itself:
// '1' is a root, '1.7' its child, '1.7.12' its grandchild.

/**
 * Levels allowed in the taxonomy. Stored `depth` runs 0..MAX_CATEGORY_DEPTH-1.
 *
 * Declared here rather than beside the table because client components need it, and
 * importing `@/db/schema` from the browser would pull drizzle's pg-core and — through
 * listings.ts — @huggingface/transformers into the client bundle.
 */
export const MAX_CATEGORY_DEPTH = 3;

/** The subset of a category row this module needs. Rows carry more. */
export type CategoryLike = {
  id: number;
  name: string;
  parentId: number | null;
  path: string;
  sortOrder: number;
};

export type CategoryTreeNode<T extends CategoryLike> = T & {
  children: CategoryTreeNode<T>[];
};

/** The path a child with `id` carries under a parent with `parentPath`. */
export function childPath(parentPath: string | null, id: number): string {
  return parentPath === null ? String(id) : `${parentPath}.${id}`;
}

/** Depth implied by a path. Roots are 0. */
export function depthOfPath(path: string): number {
  return path.split(".").length - 1;
}

/**
 * Whether re-parenting the node at `nodePath` under `candidateParentPath` would make it
 * its own ancestor.
 *
 * The separator in the prefix test is load-bearing: a bare `startsWith` would read
 * '1.70' as inside the subtree '1.7' and refuse a perfectly legal move.
 */
export function wouldCreateCycle(nodePath: string, candidateParentPath: string): boolean {
  return (
    candidateParentPath === nodePath || candidateParentPath.startsWith(`${nodePath}.`)
  );
}

/** Siblings under `parentId`, ordered by `sortOrder` then name. */
export function childrenOf<T extends CategoryLike>(rows: T[], parentId: number | null): T[] {
  return rows
    .filter((row) => row.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Root-to-node inclusive. Empty if `id` is not in `rows`. */
export function ancestorChain<T extends CategoryLike>(rows: T[], id: number): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const node = byId.get(id);
  if (!node) return [];

  // Walk the stored path rather than following parentId links: the path is one field
  // read instead of a chain of lookups, and it is the same source the database filters on.
  return node.path
    .split(".")
    .map((part) => byId.get(Number(part)))
    .filter((row): row is T => row !== undefined);
}

/** Nests a flat list. Nodes whose parent is missing from `rows` are dropped. */
export function buildCategoryTree<T extends CategoryLike>(
  rows: T[],
): CategoryTreeNode<T>[] {
  const byId = new Map<number, CategoryTreeNode<T>>(
    rows.map((row) => [row.id, { ...row, children: [] }]),
  );

  const roots: CategoryTreeNode<T>[] = [];

  for (const node of byId.values()) {
    if (node.parentId === null) {
      roots.push(node);
      continue;
    }
    byId.get(node.parentId)?.children.push(node);
  }

  const sortRecursively = (nodes: CategoryTreeNode<T>[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    nodes.forEach((node) => sortRecursively(node.children));
  };
  sortRecursively(roots);

  return roots;
}
