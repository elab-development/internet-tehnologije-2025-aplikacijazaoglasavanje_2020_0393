// ─── Category database helpers ────────────────────────────────────────────────
// The queries the category routes and the listing routes share. Path *arithmetic* lives
// in src/lib/categories.ts and stays pure; this file is the part that needs a database.

import { and, eq, like, ne, sql } from "drizzle-orm";

import { db, type Database } from "./index";
import { categories, type Category } from "./schema";

/**
 * Either the pool-backed client or a transaction handle.
 *
 * `rewriteSubtreePaths` must be able to run inside the same transaction as the update
 * that moved the node — passing the module-level `db` there would commit the two halves
 * of a move separately, and a failure between them leaves every descendant's `path`
 * disagreeing with its `parentId`.
 */
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function findCategoryById(id: number): Promise<Category | null> {
  const [found] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);

  return found ?? null;
}

/** Whether any category names `id` as its parent. */
export async function hasChildren(id: number): Promise<boolean> {
  const [child] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.parentId, id))
    .limit(1);

  return child !== undefined;
}

/**
 * Whether a listing may be filed under `id`: it must exist and have no children.
 *
 * Leaf-only (spec D12) because a listing under "Electronics" when "Electronics › Phones"
 * exists is invisible to anyone drilling down.
 */
export async function isLeafCategory(id: number): Promise<boolean> {
  const category = await findCategoryById(id);
  if (!category) return false;
  return !(await hasChildren(id));
}

/**
 * The maximum depth anywhere inside the subtree rooted at `path`, relative to that root.
 *
 * Used before a move: hanging a two-level subtree under a node already at depth 1 would
 * put its leaves at depth 3, which the CHECK constraint would reject *after* the parent
 * had already been rewritten.
 */
export async function subtreeHeight(path: string): Promise<number> {
  const [result] = await db
    .select({ maxDepth: sql<number>`max(${categories.depth})` })
    .from(categories)
    .where(like(categories.path, `${path}.%`));

  const deepest = result?.maxDepth ?? null;
  if (deepest === null) return 0;

  return deepest - (path.split(".").length - 1);
}

/**
 * Rewrites every descendant path when a subtree moves.
 *
 * One statement: `replace` on the prefix, and a depth shift by the same delta. Doing this
 * row by row would leave the tree inconsistent if the process died halfway.
 */
export async function rewriteSubtreePaths(
  executor: Executor,
  oldPrefix: string,
  newPrefix: string,
  depthDelta: number,
): Promise<void> {
  await executor
    .update(categories)
    .set({
      // The position argument needs an explicit ::integer cast: Postgres cannot infer a
      // type for a bare parameter used as SUBSTRING's FROM position, and rather than
      // erroring it silently evaluates the whole expression to NULL — which then fails
      // the path NOT NULL constraint instead of pointing at the real cause.
      path: sql`${newPrefix} || substring(${categories.path} from ${oldPrefix.length + 1}::integer)`,
      depth: sql`${categories.depth} + ${depthDelta}`,
    })
    .where(and(like(categories.path, `${oldPrefix}.%`), ne(categories.path, oldPrefix)));
}
