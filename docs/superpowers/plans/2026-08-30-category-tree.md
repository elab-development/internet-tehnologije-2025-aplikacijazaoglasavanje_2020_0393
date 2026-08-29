# Category Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat `categories` table into a three-level tree, so "Electronics › Phones › Smartphones" is expressible and filtering by a parent returns everything beneath it.

**Architecture:** Adjacency list (`parent_id`) plus a materialised `path` column holding the ancestor id chain including self (`'3'`, `'3.7'`, `'3.7.12'`). Descendant filtering becomes an indexed prefix match rather than a recursive CTE on every browse query. All path arithmetic lives in pure functions in `src/lib/categories.ts` so it is unit-testable without a database; everything that touches the database lives in `src/db/categories.ts`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle ORM, PostgreSQL, Zod, Vitest (projects: `unit`, `integration`, `component`), Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-30-listings-orders-reviews-categories-design.md` (Part 1, §3)

## Global Constraints

- **Depth cap is 3 levels**, stored as `depth` 0–2 (spec D13). Enforced by a Zod check, a route check, and a Postgres `CHECK` constraint.
- **Listings attach to leaf categories only** (spec D12) — a category with any child may not be a listing's `categoryId`.
- **`?categoryId=N` means "N and all descendants"** (spec §3.3). This is a deliberate behaviour change to an existing public parameter.
- **`GET /api/categories` stays a flat array.** The new columns are additive; no existing consumer may break. The client builds the tree.
- **Path values are server-generated only.** Nothing user-supplied ever reaches a `LIKE` pattern.
- **Migrations are hand-written SQL** with prose explaining the reasoning, following `drizzle/0006`–`0010`. `npm run db:generate` will not produce the backfill; do not use it for this work.
- **Run commands from `c2c-e-commerce/`**, not the repo root.
- Working directory for all paths below: `c2c-e-commerce/` unless the path starts with `docs/`.

---

## File Structure

**Create:**

| File | Responsibility |
|------|----------------|
| `drizzle/0011_category_tree.sql` | Adds the four columns, backfills roots, adds the CHECK and the prefix index |
| `src/lib/categories.ts` | Pure path arithmetic and tree building. No database imports. Shared by server and client. |
| `src/lib/categories.test.ts` | Unit tests for the above |
| `src/db/categories.ts` | Database helpers: leaf lookup, subtree rewrite |
| `src/app/api/categories/route.integration.test.ts` | POST tree semantics |
| `src/app/api/categories/[id]/route.integration.test.ts` | PUT re-parenting, DELETE guard |
| `src/app/api/listings/category-filter.integration.test.ts` | Descendant filtering and leaf-only validation |
| `src/components/categories/CategorySelect.tsx` | Cascading selects for the listing form |
| `src/components/categories/CategorySelect.component.test.tsx` | Its tests |
| `src/components/categories/CategoryTreeFilter.tsx` | Collapsible tree filter for browse |
| `src/components/categories/CategoryTreeFilter.component.test.tsx` | Its tests |
| `src/components/categories/CategoryBreadcrumb.tsx` | Ancestor chain on the detail page |
| `src/components/categories/CategoryBreadcrumb.component.test.tsx` | Its tests |

**Modify:**

| File | Change |
|------|--------|
| `src/db/schema/categories.ts` | Four new columns, self-reference, check, index |
| `src/lib/validation.ts` | `parentId`/`sortOrder` on both category schemas |
| `src/app/api/categories/route.ts` | POST computes `path`/`depth` from the parent |
| `src/app/api/categories/[id]/route.ts` | PUT re-parents with a cycle check; DELETE refuses a node with children |
| `src/lib/listings-query.ts` | `categoryId` filter becomes a descendant match |
| `src/app/api/listings/route.ts` | Leaf-only validation on create |
| `src/app/api/listings/[id]/route.ts` | Leaf-only validation on update |
| `src/test/factories.ts` | `makeCategory` accepts `parentId`, computes `path`/`depth` |
| `src/db/seed.ts` | A real two-level taxonomy |
| `src/lib/swagger.ts` | `Category` schema gains the columns; `categoryId` description states the new meaning |
| `src/components/listings/ListingForm.tsx` | Flat `<select>` → `CategorySelect` |
| `src/app/(frontend)/listings/page.tsx` | Flat `<select>` → `CategoryTreeFilter` |
| `src/app/(frontend)/listings/[id]/page.tsx` | Category name → `CategoryBreadcrumb` |

**Unchanged on purpose:** `src/types/api.ts` — `Category` is `typeof categories.$inferSelect`, so it picks up the new columns automatically. `docs/security/rbac-matrix.md` — the endpoints and their roles do not change.

---

### Task 1: Schema, migration, and factory

**Files:**
- Create: `drizzle/0011_category_tree.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema/categories.ts`
- Modify: `src/test/factories.ts:60-113` (the `MakeCategoryOptions` type and `makeCategory`)
- Test: `src/db/schema/categories.integration.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `categories` rows gain `parentId: number | null`, `path: string`, `depth: number`, `sortOrder: number`.
  - `makeCategory(options?: MakeCategoryOptions): Promise<Category>` where `MakeCategoryOptions` gains `parentId?: number | null` and `sortOrder?: number`. When `parentId` is given, the factory computes `path` and `depth` from the parent.

- [ ] **Step 1: Write the failing test**

Create `src/db/schema/categories.integration.test.ts`:

```ts
/**
 * Part 1 spec — the category tree's storage.
 *
 * Path and depth are the two things every later query trusts, so they are asserted
 * against the database rather than against the factory that wrote them.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { categories } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeCategory } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

describe("categories tree columns", () => {
  it("gives a root category its own id as its path, at depth 0", async () => {
    const root = await makeCategory({ name: "Electronics" });

    expect(root.parentId).toBeNull();
    expect(root.path).toBe(String(root.id));
    expect(root.depth).toBe(0);
  });

  it("gives a child the parent's path plus its own id, at depth 1", async () => {
    const root = await makeCategory({ name: "Electronics" });
    const child = await makeCategory({ name: "Phones", parentId: root.id });

    expect(child.parentId).toBe(root.id);
    expect(child.path).toBe(`${root.id}.${child.id}`);
    expect(child.depth).toBe(1);
  });

  it("gives a grandchild a three-segment path at depth 2", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });
    const grandchild = await makeCategory({ parentId: child.id });

    expect(grandchild.path).toBe(`${root.id}.${child.id}.${grandchild.id}`);
    expect(grandchild.depth).toBe(2);
  });

  it("refuses a fourth level at the database", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });
    const grandchild = await makeCategory({ parentId: child.id });

    // The CHECK is the last line of defence behind the Zod and route checks. If it is
    // missing, a bug anywhere above it silently produces an unusable taxonomy.
    await expect(makeCategory({ parentId: grandchild.id })).rejects.toThrow();
  });

  it("refuses to delete a category that still has children", async () => {
    const db = await getTestDb();
    const root = await makeCategory();
    await makeCategory({ parentId: root.id });

    await expect(
      db.delete(categories).where(eq(categories.id, root.id)),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -- src/db/schema/categories.integration.test.ts`
Expected: FAIL — `makeCategory` does not accept `parentId`, and `root.path` is `undefined`.

- [ ] **Step 3: Write the migration**

Create `drizzle/0011_category_tree.sql`:

```sql
-- Part 1 of the 2026-08-30 redesign — categories become a tree.
--
-- `path` is the materialised ancestor chain including the row itself ('3', '3.7',
-- '3.7.12'). It exists so that "everything under Electronics" is an indexed prefix
-- match instead of a recursive CTE on every browse query — filtering by category is on
-- the hot path and recursion there is a cost paid per request forever.
--
-- Every pre-existing category becomes a root: nothing in the flat table expressed a
-- parent, so inventing one here would be fabricating taxonomy.

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "parent_id" integer;
--> statement-breakpoint
-- ON DELETE RESTRICT, not CASCADE: deleting a node that still has children should fail
-- loudly. A cascade would silently delete a subtree and orphan every listing under it.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parent_id_categories_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "path" text;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "depth" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "categories" SET "path" = "id"::text WHERE "path" IS NULL;
--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "path" SET NOT NULL;
--> statement-breakpoint
-- Depth 0..2 is three levels. The cap is repeated in Zod and in the route; this is the
-- copy that a bug in either of those cannot get past.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_depth_range" CHECK ("depth" >= 0 AND "depth" <= 2);
--> statement-breakpoint
-- text_pattern_ops so `path LIKE '3.%'` can use the index. The default opclass does not
-- support prefix matching under a non-C collation, so without this the index is dead
-- weight and the planner falls back to a sequential scan.
CREATE INDEX IF NOT EXISTS "categories_path_prefix_idx"
  ON "categories" ("path" text_pattern_ops);
```

- [ ] **Step 4: Register the migration in the journal**

Append to the `entries` array in `drizzle/meta/_journal.json`, after the `0010` entry:

```json
    {
      "idx": 11,
      "version": "7",
      "when": 1771946600000,
      "tag": "0011_category_tree",
      "breakpoints": true
    }
```

- [ ] **Step 5: Update the schema file**

Replace the whole of `src/db/schema/categories.ts`:

Note: the depth cap is **not** declared here. `MAX_CATEGORY_DEPTH` lives in
`src/lib/categories.ts` (Task 2) because client components need it, and importing
`@/db/schema` from the browser would pull `drizzle-orm/pg-core` and — through
`listings.ts` — `@huggingface/transformers` into the client bundle. The SQL `CHECK`
below uses literals for the same reason.

```ts
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
} from "drizzle-orm/pg-core";

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").unique().notNull(),
    description: text("description"),

    // The self-reference needs an explicit AnyPgColumn return type: without it
    // TypeScript cannot infer a circular reference and the file fails to compile.
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "restrict",
    }),

    /** Ancestor ids including self, dot-separated: '3', '3.7', '3.7.12'. */
    path: text("path").notNull(),

    /** 0 for roots. Derivable from `path`, stored so the CHECK below can exist. */
    depth: integer("depth").default(0).notNull(),

    /** Curated order within a parent — alphabetical is wrong for a taxonomy. */
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    index("categories_path_prefix_idx").on(table.path),
    check("categories_depth_range", sql`${table.depth} >= 0 AND ${table.depth} <= 2`),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
```

- [ ] **Step 6: Update the factory**

In `src/test/factories.ts`, replace the `MakeCategoryOptions` type and the `makeCategory` function (currently around lines 90–113):

```ts
export type MakeCategoryOptions = Partial<
  Pick<Category, "name" | "slug" | "description" | "sortOrder">
> & {
  /** Parent category. Omit or pass null for a root. */
  parentId?: number | null;
};

export async function makeCategory(options: MakeCategoryOptions = {}): Promise<Category> {
  const db = await getTestDb();
  const n = next();

  const parentId = options.parentId ?? null;

  // The parent's path is what the child's path is built from, so it has to be read
  // rather than assumed — a caller may have created the parent in an earlier test step.
  let parentPath: string | null = null;
  if (parentId !== null) {
    const [parent] = await db
      .select({ path: categories.path })
      .from(categories)
      .where(eq(categories.id, parentId))
      .limit(1);
    if (!parent) throw new Error(`makeCategory: parent ${parentId} does not exist`);
    parentPath = parent.path;
  }

  const depth = parentPath === null ? 0 : parentPath.split(".").length;

  // Insert with a placeholder path, then set it from the returned id: the row cannot
  // know its own id before it exists.
  const [inserted] = await db
    .insert(categories)
    .values({
      name: options.name ?? `Category ${n}`,
      slug: options.slug ?? `category-${n}`,
      description: options.description ?? null,
      parentId,
      path: "",
      depth,
      sortOrder: options.sortOrder ?? 0,
    })
    .returning();

  const path = parentPath === null ? String(inserted.id) : `${parentPath}.${inserted.id}`;

  const [category] = await db
    .update(categories)
    .set({ path })
    .where(eq(categories.id, inserted.id))
    .returning();

  return category;
}
```

Add `eq` to the `drizzle-orm` import at the top of the file if it is not already there:

```ts
import { eq } from "drizzle-orm";
```

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `npm run test:integration -- src/db/schema/categories.integration.test.ts`
Expected: PASS, 5 tests.

Note: the depth CHECK fires on the *insert* of the fourth level, which happens before the factory's `UPDATE`, so the rejection in the fourth test comes from the insert.

- [ ] **Step 8: Verify nothing else broke**

Run: `npm run test:integration`
Expected: PASS. `makeCategory()` with no arguments still produces a root, so every existing caller is unaffected.

- [ ] **Step 9: Commit**

```bash
git add drizzle/0011_category_tree.sql drizzle/meta/_journal.json \
  src/db/schema/categories.ts src/test/factories.ts \
  src/db/schema/categories.integration.test.ts
git commit -m "feat(categories): parent_id, materialised path, depth cap"
```

---

### Task 2: Pure path arithmetic

**Files:**
- Create: `src/lib/categories.ts`
- Test: `src/lib/categories.test.ts` (create)

**Interfaces:**
- Consumes: nothing. This file imports nothing from `@/db` — that is what makes it safe
  for client components and runnable in the `unit` project.
- Produces, all pure and importable from client components:
  - `MAX_CATEGORY_DEPTH = 3` — the single declaration of the cap; routes and components
    both import it from here
  - `childPath(parentPath: string | null, id: number): string`
  - `depthOfPath(path: string): number`
  - `wouldCreateCycle(nodePath: string, candidateParentPath: string): boolean`
  - `childrenOf<T extends CategoryLike>(rows: T[], parentId: number | null): T[]`
  - `ancestorChain<T extends CategoryLike>(rows: T[], id: number): T[]`
  - `buildCategoryTree<T extends CategoryLike>(rows: T[]): CategoryTreeNode<T>[]`
  - `type CategoryLike = { id: number; name: string; parentId: number | null; path: string; sortOrder: number }`
  - `type CategoryTreeNode<T> = T & { children: CategoryTreeNode<T>[] }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/categories.test.ts`:

```ts
/**
 * Part 1 spec — path arithmetic.
 *
 * Kept free of any database import so it runs in the `unit` project: these are the
 * rules every route and every component depends on, and they should be provable in
 * milliseconds.
 */
import { describe, expect, it } from "vitest";

import {
  ancestorChain,
  buildCategoryTree,
  childPath,
  childrenOf,
  depthOfPath,
  wouldCreateCycle,
  type CategoryLike,
} from "./categories";

/** Electronics(1) › Phones(7) › Smartphones(12); Clothing(2) is a second root. */
const ROWS: CategoryLike[] = [
  { id: 1, name: "Electronics", parentId: null, path: "1", sortOrder: 0 },
  { id: 7, name: "Phones", parentId: 1, path: "1.7", sortOrder: 0 },
  { id: 12, name: "Smartphones", parentId: 7, path: "1.7.12", sortOrder: 1 },
  { id: 13, name: "Feature phones", parentId: 7, path: "1.7.13", sortOrder: 0 },
  { id: 2, name: "Clothing", parentId: null, path: "2", sortOrder: 1 },
];

describe("childPath", () => {
  it("gives a root its own id", () => {
    expect(childPath(null, 4)).toBe("4");
  });

  it("appends to the parent's path", () => {
    expect(childPath("1.7", 12)).toBe("1.7.12");
  });
});

describe("depthOfPath", () => {
  it("counts roots as 0", () => {
    expect(depthOfPath("1")).toBe(0);
  });

  it("counts a grandchild as 2", () => {
    expect(depthOfPath("1.7.12")).toBe(2);
  });
});

describe("wouldCreateCycle", () => {
  it("rejects making a node its own parent", () => {
    expect(wouldCreateCycle("1.7", "1.7")).toBe(true);
  });

  it("rejects moving a node under its own descendant", () => {
    expect(wouldCreateCycle("1.7", "1.7.12")).toBe(true);
  });

  it("allows moving a node under an unrelated branch", () => {
    expect(wouldCreateCycle("1.7", "2")).toBe(false);
  });

  it("does not mistake a sibling with a shared id prefix for a descendant", () => {
    // '1.70' starts with '1.7' as a string but is not inside that subtree. Without the
    // separator in the comparison this returns true and legal moves are refused.
    expect(wouldCreateCycle("1.7", "1.70")).toBe(false);
  });
});

describe("childrenOf", () => {
  it("returns roots for a null parent, in sortOrder", () => {
    expect(childrenOf(ROWS, null).map((c) => c.id)).toEqual([1, 2]);
  });

  it("orders siblings by sortOrder, then name", () => {
    expect(childrenOf(ROWS, 7).map((c) => c.name)).toEqual([
      "Feature phones",
      "Smartphones",
    ]);
  });

  it("returns nothing for a leaf", () => {
    expect(childrenOf(ROWS, 12)).toEqual([]);
  });
});

describe("ancestorChain", () => {
  it("returns root-to-node inclusive", () => {
    expect(ancestorChain(ROWS, 12).map((c) => c.name)).toEqual([
      "Electronics",
      "Phones",
      "Smartphones",
    ]);
  });

  it("returns just the node for a root", () => {
    expect(ancestorChain(ROWS, 1).map((c) => c.name)).toEqual(["Electronics"]);
  });

  it("returns empty for an unknown id", () => {
    expect(ancestorChain(ROWS, 999)).toEqual([]);
  });
});

describe("buildCategoryTree", () => {
  it("nests children under their parent", () => {
    const tree = buildCategoryTree(ROWS);

    expect(tree.map((n) => n.name)).toEqual(["Electronics", "Clothing"]);
    expect(tree[0].children.map((n) => n.name)).toEqual(["Phones"]);
    expect(tree[0].children[0].children.map((n) => n.name)).toEqual([
      "Feature phones",
      "Smartphones",
    ]);
  });

  it("drops a node whose parent is absent rather than losing the whole tree", () => {
    // A partial fetch should degrade to fewer branches, not to a crash.
    const orphaned = ROWS.filter((r) => r.id !== 7);
    const tree = buildCategoryTree(orphaned);

    expect(tree.map((n) => n.name)).toEqual(["Electronics", "Clothing"]);
    expect(tree[0].children).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- src/lib/categories.test.ts`
Expected: FAIL — cannot resolve `./categories`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/categories.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm run test:unit -- src/lib/categories.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/categories.ts src/lib/categories.test.ts
git commit -m "feat(categories): pure path arithmetic and tree building"
```

---

### Task 3: Validation schemas

**Files:**
- Modify: `src/lib/validation.ts:135-149` (`CreateCategorySchema`, `UpdateCategorySchema`)
- Test: `src/lib/validation.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CreateCategorySchema` and `UpdateCategorySchema` accepting `parentId?: number | null` and `sortOrder?: number`.

`parentId` is `.nullable().optional()` deliberately, and the route must branch on
`=== undefined` rather than falsiness: an explicit `null` means "make this a root",
which is a different instruction from "leave the parent alone".

- [ ] **Step 1: Write the failing test**

Append to `src/lib/validation.test.ts`:

```ts
describe("Part 1 — category tree fields", () => {
  it("accepts a parentId on create", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Phones",
      slug: "phones",
      parentId: 3,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.parentId).toBe(3);
  });

  it("accepts an explicit null parentId, meaning a root", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Electronics",
      slug: "electronics",
      parentId: null,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.parentId).toBeNull();
  });

  it("leaves parentId undefined when it is not sent", () => {
    const result = CreateCategorySchema.safeParse({ name: "Books", slug: "books" });

    expect(result.success).toBe(true);
    expect(result.success && result.data.parentId).toBeUndefined();
  });

  it("rejects a non-integer parentId", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Phones",
      slug: "phones",
      parentId: 1.5,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative parentId", () => {
    expect(
      CreateCategorySchema.safeParse({ name: "a", slug: "a", parentId: 0 }).success,
    ).toBe(false);
  });

  it("accepts sortOrder on update", () => {
    const result = UpdateCategorySchema.safeParse({ sortOrder: 5 });

    expect(result.success).toBe(true);
    expect(result.success && result.data.sortOrder).toBe(5);
  });

  it("still rejects an empty update body", () => {
    expect(UpdateCategorySchema.safeParse({}).success).toBe(false);
  });
});
```

Make sure `CreateCategorySchema` and `UpdateCategorySchema` are in the file's import list from `./validation`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- src/lib/validation.test.ts`
Expected: FAIL — `result.data.parentId` is `undefined` on the first test, because Zod strips unknown keys.

- [ ] **Step 3: Write the implementation**

In `src/lib/validation.ts`, replace `CreateCategorySchema` and `UpdateCategorySchema`:

```ts
/**
 * `parentId` is nullable *and* optional, and the two mean different things: an explicit
 * `null` makes the category a root, while omitting it leaves the parent untouched. Route
 * code must branch on `=== undefined`, never on falsiness.
 */
export const CreateCategorySchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  slug: z.string().trim().min(1, "slug is required"),
  description: z.string().trim().nullable().optional(),
  parentId: z
    .number()
    .int("parentId must be an integer")
    .positive("parentId must be a positive integer")
    .nullable()
    .optional(),
  sortOrder: z.number().int("sortOrder must be an integer").optional(),
});

export const UpdateCategorySchema = z
  .object({
    name: z.string().trim().min(1, "name must be a non-empty string").optional(),
    slug: z.string().trim().min(1, "slug must be a non-empty string").optional(),
    description: z.string().trim().nullable().optional(),
    parentId: z
      .number()
      .int("parentId must be an integer")
      .positive("parentId must be a positive integer")
      .nullable()
      .optional(),
    sortOrder: z.number().int("sortOrder must be an integer").optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No updatable fields provided",
  });
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm run test:unit -- src/lib/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat(categories): parentId and sortOrder in the category schemas"
```

---

### Task 4: Category API — create, re-parent, delete

**Files:**
- Create: `src/db/categories.ts`
- Modify: `src/app/api/categories/route.ts` (the `POST` handler and its swagger block)
- Modify: `src/app/api/categories/[id]/route.ts` (the `PUT` and `DELETE` handlers)
- Modify: `src/lib/swagger.ts:72-81` (the `Category` schema)
- Test: `src/app/api/categories/route.integration.test.ts` (create)
- Test: `src/app/api/categories/[id]/route.integration.test.ts` (create)

**Interfaces:**
- Consumes: `MAX_CATEGORY_DEPTH`, `childPath`, `depthOfPath`, `wouldCreateCycle` from `@/lib/categories` (Task 2); the schemas from Task 3.
- Produces:
  - `src/db/categories.ts` exporting `findCategoryById(id: number): Promise<Category | null>`, `hasChildren(id: number): Promise<boolean>`, `isLeafCategory(id: number): Promise<boolean>`, `subtreeHeight(path: string): Promise<number>`, and `rewriteSubtreePaths(executor: Executor, oldPrefix: string, newPrefix: string, depthDelta: number): Promise<void>` where `Executor` is the pool client or a transaction handle.
  - `POST /api/categories` accepting `parentId`; `PUT /api/categories/[id]` accepting `parentId`; `DELETE` refusing a node with children.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/categories/route.integration.test.ts`:

```ts
/**
 * Part 1 spec — creating categories in a tree.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { signToken } from "@/lib/auth";
import { resetDb } from "@/test/db";
import { makeCategory, makeUser } from "@/test/factories";

let adminToken: string;

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: "admin" });
  adminToken = signToken({ sub: admin.id, email: admin.email, role: admin.role });
});

async function createCategory(body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/categories", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/categories — tree placement", () => {
  it("creates a root with its own id as its path", async () => {
    const response = await createCategory({ name: "Electronics", slug: "electronics" });
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created.parentId).toBeNull();
    expect(created.path).toBe(String(created.id));
    expect(created.depth).toBe(0);
  });

  it("creates a child under its parent", async () => {
    const root = await makeCategory({ slug: "electronics" });

    const response = await createCategory({
      name: "Phones",
      slug: "phones",
      parentId: root.id,
    });
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created.path).toBe(`${root.id}.${created.id}`);
    expect(created.depth).toBe(1);
  });

  it("rejects an unknown parent with 400", async () => {
    const response = await createCategory({
      name: "Orphan",
      slug: "orphan",
      parentId: 999999,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Parent category not found",
    });
  });

  it("rejects a fourth level with 400 rather than letting the CHECK fire", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });
    const grandchild = await makeCategory({ parentId: child.id });

    const response = await createCategory({
      name: "Too deep",
      slug: "too-deep",
      parentId: grandchild.id,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Categories may be nested at most 3 levels deep",
    });
  });

  it("still rejects a duplicate slug with 409", async () => {
    await makeCategory({ slug: "electronics" });

    const response = await createCategory({ name: "Electronics", slug: "electronics" });

    expect(response.status).toBe(409);
  });
});
```

Create `src/app/api/categories/[id]/route.integration.test.ts`:

```ts
/**
 * Part 1 spec — re-parenting and deleting inside a tree.
 *
 * The subtree rewrite is the part worth testing hardest: getting it wrong leaves rows
 * whose `path` disagrees with their `parentId`, and every descendant filter silently
 * returns the wrong listings from then on.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { categories } from "@/db/schema";
import { signToken } from "@/lib/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeCategory, makeUser } from "@/test/factories";

let adminToken: string;

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: "admin" });
  adminToken = signToken({ sub: admin.id, email: admin.email, role: admin.role });
});

async function updateCategory(id: number, body: unknown) {
  const { PUT } = await import("./route");
  return PUT(
    new NextRequest(`http://localhost/api/categories/${id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

async function deleteCategory(id: number) {
  const { DELETE } = await import("./route");
  return DELETE(
    new NextRequest(`http://localhost/api/categories/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${adminToken}` },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

async function row(id: number) {
  const db = await getTestDb();
  const [found] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return found;
}

describe("PUT /api/categories/[id] — re-parenting", () => {
  it("rewrites the moved node and its whole subtree", async () => {
    const electronics = await makeCategory({ slug: "electronics" });
    const phones = await makeCategory({ slug: "phones", parentId: electronics.id });
    const smartphones = await makeCategory({
      slug: "smartphones",
      parentId: phones.id,
    });
    const clothing = await makeCategory({ slug: "clothing" });

    const response = await updateCategory(phones.id, { parentId: clothing.id });

    expect(response.status).toBe(200);
    expect((await row(phones.id)).path).toBe(`${clothing.id}.${phones.id}`);
    expect((await row(smartphones.id)).path).toBe(
      `${clothing.id}.${phones.id}.${smartphones.id}`,
    );
    expect((await row(smartphones.id)).depth).toBe(2);
  });

  it("promotes a node to a root when parentId is explicitly null", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });

    const response = await updateCategory(child.id, { parentId: null });

    expect(response.status).toBe(200);
    expect((await row(child.id)).parentId).toBeNull();
    expect((await row(child.id)).path).toBe(String(child.id));
    expect((await row(child.id)).depth).toBe(0);
  });

  it("refuses to move a node under its own descendant", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });

    const response = await updateCategory(root.id, { parentId: child.id });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "A category cannot be moved under its own descendant",
    });
  });

  it("refuses a move that would push a descendant past the depth cap", async () => {
    const rootA = await makeCategory();
    const childA = await makeCategory({ parentId: rootA.id });
    // A two-level subtree cannot be hung under a node that is already at depth 1.
    const rootB = await makeCategory();
    const childB = await makeCategory({ parentId: rootB.id });
    await makeCategory({ parentId: childA.id });

    const response = await updateCategory(childA.id, { parentId: childB.id });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Categories may be nested at most 3 levels deep",
    });
  });

  it("leaves the parent alone when parentId is omitted", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });

    const response = await updateCategory(child.id, { name: "Renamed" });

    expect(response.status).toBe(200);
    expect((await row(child.id)).parentId).toBe(root.id);
    expect((await row(child.id)).path).toBe(`${root.id}.${child.id}`);
  });
});

describe("DELETE /api/categories/[id]", () => {
  it("refuses to delete a category that still has children", async () => {
    const root = await makeCategory();
    await makeCategory({ parentId: root.id });

    const response = await deleteCategory(root.id);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Delete or move this category's subcategories first",
    });
    expect(await row(root.id)).toBeDefined();
  });

  it("deletes a leaf", async () => {
    const leaf = await makeCategory();

    const response = await deleteCategory(leaf.id);

    expect(response.status).toBe(200);
    expect(await row(leaf.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm run test:integration -- src/app/api/categories`
Expected: FAIL — `created.path` is `undefined`, re-parenting is ignored, delete succeeds with children.

- [ ] **Step 3: Write the database helpers**

Create `src/db/categories.ts`:

```ts
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
      path: sql`${newPrefix} || substring(${categories.path} from ${oldPrefix.length + 1})`,
      depth: sql`${categories.depth} + ${depthDelta}`,
    })
    .where(and(like(categories.path, `${oldPrefix}.%`), ne(categories.path, oldPrefix)));
}
```

- [ ] **Step 4: Update the POST handler**

In `src/app/api/categories/route.ts`, replace the body of `POST` after the slug conflict check, and add the imports:

```ts
import { findCategoryById } from "@/db/categories";
import { MAX_CATEGORY_DEPTH, childPath, depthOfPath } from "@/lib/categories";
```

```ts
    const { name, slug, description, parentId, sortOrder } = parsed.data;

    // check uniqueness
    const [existing] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);
    if (existing) return jsonError("A category with that slug already exists", 409);

    // `parentId` is nullable and optional; both null and undefined mean "a root" on
    // create, and only an explicit id means otherwise.
    let parentPath: string | null = null;
    if (parentId !== undefined && parentId !== null) {
      const parent = await findCategoryById(parentId);
      if (!parent) return jsonError("Parent category not found", 400);

      if (parent.depth + 1 > MAX_CATEGORY_DEPTH - 1) {
        return jsonError(
          `Categories may be nested at most ${MAX_CATEGORY_DEPTH} levels deep`,
          400,
        );
      }
      parentPath = parent.path;
    }

    // The row cannot know its own id before it exists, so the path is set in a second
    // statement. Both run in one transaction: a row with an empty path would be
    // invisible to every descendant query.
    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(categories)
        .values({
          name,
          slug,
          description: description ?? null,
          parentId: parentId ?? null,
          path: "",
          depth: parentPath === null ? 0 : depthOfPath(parentPath) + 1,
          sortOrder: sortOrder ?? 0,
        })
        .returning();

      const [withPath] = await tx
        .update(categories)
        .set({ path: childPath(parentPath, inserted.id) })
        .where(eq(categories.id, inserted.id))
        .returning();

      return withPath;
    });

    return jsonOk(created, 201);
```

Also update the `POST` swagger block's `requestBody` properties to include:

```
 *               parentId:
 *                 type: integer
 *                 nullable: true
 *                 description: Parent category. Omit or send null for a root.
 *                 example: 3
 *               sortOrder:
 *                 type: integer
 *                 description: Curated order among siblings.
 *                 example: 0
```

- [ ] **Step 5: Update the PUT and DELETE handlers**

In `src/app/api/categories/[id]/route.ts`, add the imports:

```ts
import { findCategoryById, hasChildren, rewriteSubtreePaths, subtreeHeight } from "@/db/categories";
import {
  MAX_CATEGORY_DEPTH,
  childPath,
  depthOfPath,
  wouldCreateCycle,
} from "@/lib/categories";
```

Replace the destructuring and add the re-parenting block, immediately after the existing
`description` handling and before the final `db.update(...)`:

```ts
    const { name, slug, description, parentId, sortOrder } = parsed.data;

    const updates: Partial<typeof categories.$inferInsert> = {};

    if (name !== undefined) updates.name = name;

    if (slug !== undefined) {
      // uniqueness check (exclude self)
      const [conflict] = await db
        .select()
        .from(categories)
        .where(eq(categories.slug, slug))
        .limit(1);
      if (conflict && conflict.id !== id) {
        return jsonError("A category with that slug already exists", 409);
      }
      updates.slug = slug;
    }

    if (description !== undefined) updates.description = description;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;

    // ── Re-parenting ────────────────────────────────────────────────────────
    // `undefined` means "leave the parent alone"; an explicit `null` means "make this a
    // root". Branching on falsiness would conflate the two and silently promote nodes.
    let subtreeMove: { oldPrefix: string; newPrefix: string; depthDelta: number } | null =
      null;

    if (parentId !== undefined) {
      let newParentPath: string | null = null;

      if (parentId !== null) {
        if (parentId === id) {
          return jsonError("A category cannot be moved under its own descendant", 400);
        }

        const parent = await findCategoryById(parentId);
        if (!parent) return jsonError("Parent category not found", 400);

        if (wouldCreateCycle(category.path, parent.path)) {
          return jsonError("A category cannot be moved under its own descendant", 400);
        }

        // The subtree travels with the node, so the cap applies to its deepest leaf,
        // not just to the node being moved.
        const height = await subtreeHeight(category.path);
        if (parent.depth + 1 + height > MAX_CATEGORY_DEPTH - 1) {
          return jsonError(
            `Categories may be nested at most ${MAX_CATEGORY_DEPTH} levels deep`,
            400,
          );
        }

        newParentPath = parent.path;
      }

      const newPath = childPath(newParentPath, id);
      const newDepth = newParentPath === null ? 0 : depthOfPath(newParentPath) + 1;

      updates.parentId = parentId;
      updates.path = newPath;
      updates.depth = newDepth;

      subtreeMove = {
        oldPrefix: category.path,
        newPrefix: newPath,
        depthDelta: newDepth - category.depth,
      };
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(categories)
        .set(updates)
        .where(eq(categories.id, id))
        .returning();

      // Descendants must be rewritten in the same transaction as the node itself, which
      // is why `tx` is threaded through rather than the module-level `db`: a half-applied
      // move leaves paths disagreeing with parentId, and every descendant filter quietly
      // returns the wrong listings from then on.
      if (subtreeMove) {
        await rewriteSubtreePaths(
          tx,
          subtreeMove.oldPrefix,
          subtreeMove.newPrefix,
          subtreeMove.depthDelta,
        );
      }

      return row;
    });

    return jsonOk(updated);
```

In `DELETE`, insert the guard after the existing "Category not found" check:

```ts
    if (await hasChildren(id)) {
      // ON DELETE RESTRICT would raise this as a 500 from the driver. Answering 409 with
      // an instruction is the difference between a bug report and a usable API.
      return jsonError("Delete or move this category's subcategories first", 409);
    }
```

- [ ] **Step 6: Update the shared swagger Category schema**

In `src/lib/swagger.ts`, replace the `Category` schema (lines 72–81):

```ts
      Category: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          name: { type: "string", example: "Electronics" },
          slug: { type: "string", example: "electronics" },
          description: { type: "string", nullable: true, example: "Gadgets & devices" },
          parentId: { type: "integer", nullable: true, example: null },
          path: {
            type: "string",
            description: "Dot-separated ancestor ids, including this category.",
            example: "1.7.12",
          },
          depth: { type: "integer", description: "0 for a root category.", example: 0 },
          sortOrder: { type: "integer", example: 0 },
        },
      },
```

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `npm run test:integration -- src/app/api/categories`
Expected: PASS, 12 tests.

- [ ] **Step 8: Regenerate the swagger spec**

Run: `node scripts/generate-swagger.mjs`
Expected: `src/lib/swagger-spec.json` updates.

- [ ] **Step 9: Commit**

```bash
git add src/db/categories.ts src/app/api/categories src/lib/swagger.ts src/lib/swagger-spec.json
git commit -m "feat(categories): tree-aware create, re-parent and delete"
```

---

### Task 5: Descendant filtering and leaf-only listings

**Files:**
- Modify: `src/lib/listings-query.ts:159-163` (the `categoryId` filter)
- Modify: `src/app/api/listings/route.ts` (the `POST` handler, around line 265)
- Modify: `src/app/api/listings/[id]/route.ts` (the `PUT` handler, around line 258)
- Test: `src/app/api/listings/category-filter.integration.test.ts` (create)

**Interfaces:**
- Consumes: `isLeafCategory` from `@/db/categories` (Task 4); `makeCategory` with `parentId` (Task 1).
- Produces: `GET /api/listings?categoryId=N` returning listings in `N` and all descendants; `POST`/`PUT /api/listings` rejecting a non-leaf `categoryId` with 400.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/listings/category-filter.integration.test.ts`:

```ts
/**
 * Part 1 spec — what `?categoryId=` means, and where a listing may be filed.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { signToken } from "@/lib/auth";
import { resetDb } from "@/test/db";
import { makeCategory, makeListing, makeUser } from "@/test/factories";

let sellerToken: string;
let sellerId: number;

beforeEach(async () => {
  await resetDb();
  const seller = await makeUser({ role: "seller" });
  sellerId = seller.id;
  sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
});

async function listByCategory(categoryId: number) {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/listings?categoryId=${categoryId}&limit=50`),
  );
  return (await response.json()) as { data: { id: number }[] };
}

async function createListing(categoryId: number) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/listings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        title: "A thing",
        description: "A description",
        price: 10,
        categoryId,
      }),
    }),
  );
}

describe("GET /api/listings?categoryId= — descendants included", () => {
  it("returns listings filed under a descendant when filtering by an ancestor", async () => {
    const electronics = await makeCategory({ slug: "electronics" });
    const phones = await makeCategory({ slug: "phones", parentId: electronics.id });
    const smartphones = await makeCategory({
      slug: "smartphones",
      parentId: phones.id,
    });

    const deep = await makeListing({ categoryId: smartphones.id, sellerId });

    const result = await listByCategory(electronics.id);

    expect(result.data.map((l) => l.id)).toContain(deep.id);
  });

  it("does not return listings from a sibling branch", async () => {
    const electronics = await makeCategory({ slug: "electronics" });
    const phones = await makeCategory({ slug: "phones", parentId: electronics.id });
    const clothing = await makeCategory({ slug: "clothing" });

    await makeListing({ categoryId: phones.id, sellerId });
    const unrelated = await makeListing({ categoryId: clothing.id, sellerId });

    const result = await listByCategory(electronics.id);

    expect(result.data.map((l) => l.id)).not.toContain(unrelated.id);
  });

  it("returns a leaf's own listings when filtering by that leaf", async () => {
    const root = await makeCategory();
    const leaf = await makeCategory({ parentId: root.id });
    const listing = await makeListing({ categoryId: leaf.id, sellerId });

    const result = await listByCategory(leaf.id);

    expect(result.data.map((l) => l.id)).toEqual([listing.id]);
  });
});

describe("POST /api/listings — leaf categories only", () => {
  it("accepts a leaf category", async () => {
    const root = await makeCategory();
    const leaf = await makeCategory({ parentId: root.id });

    const response = await createListing(leaf.id);

    expect(response.status).toBe(201);
  });

  it("rejects a category that has children", async () => {
    const root = await makeCategory();
    await makeCategory({ parentId: root.id });

    const response = await createListing(root.id);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Listings must be filed under a category with no subcategories",
    });
  });

  it("rejects an unknown category", async () => {
    const response = await createListing(999999);

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -- src/app/api/listings/category-filter.integration.test.ts`
Expected: FAIL — the ancestor filter returns nothing, and a non-leaf category is accepted with 201.

- [ ] **Step 3: Rewrite the categoryId filter**

In `src/lib/listings-query.ts`, add `categories` to the schema import and `sql` to the
`drizzle-orm` import, then replace the `categoryId` block (currently lines 159–163):

```ts
  const categoryId = searchParams.get("categoryId");
  if (categoryId) {
    const id = parseInt(categoryId, 10);
    if (!isNaN(id)) {
      // "N and everything beneath it" (spec §3.3). The correlated subquery reads the
      // target's path and prefix-matches against the index, so this stays one round trip
      // and never recurses. `id` is a parsed integer and the path comes from the
      // database, so nothing user-supplied reaches the LIKE pattern.
      conditions.push(
        sql`${listings.categoryId} IN (
          SELECT c.id FROM ${categories} c
          WHERE c.id = ${id}
             OR c.path LIKE (SELECT p.path FROM ${categories} p WHERE p.id = ${id}) || '.%'
        )`,
      );
    }
  }
```

- [ ] **Step 4: Add leaf validation to listing create**

In `src/app/api/listings/route.ts`, add the import:

```ts
import { isLeafCategory } from "@/db/categories";
```

and insert immediately after `const { title, description, price, imageUrl, categoryId } = parsed.data;`:

```ts
    // Leaf-only (spec D12): a listing under "Electronics" when "Electronics › Phones"
    // exists cannot be found by anyone drilling down.
    if (categoryId !== undefined && categoryId !== null) {
      if (!(await isLeafCategory(categoryId))) {
        return jsonError(
          "Listings must be filed under a category with no subcategories",
          400,
        );
      }
    }
```

- [ ] **Step 5: Add the same validation to listing update**

In `src/app/api/listings/[id]/route.ts`, add the same import, and insert immediately
after `const { title, description, price, imageUrl, categoryId, status } = parsed.data;`:

```ts
    if (categoryId !== undefined && categoryId !== null) {
      if (!(await isLeafCategory(categoryId))) {
        return jsonError(
          "Listings must be filed under a category with no subcategories",
          400,
        );
      }
    }
```

- [ ] **Step 6: Update the swagger description of the parameter**

In `src/app/api/listings/route.ts`, find the `categoryId` query parameter in the `GET`
swagger block and replace its `description` with:

```
 *         description: >
 *           Category id. Includes every descendant category, so filtering by a parent
 *           returns listings filed under its subcategories.
```

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `npm run test:integration -- src/app/api/listings/category-filter.integration.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Check the rest of the listing suite still passes**

Run: `npm run test:integration -- src/app/api/listings`
Expected: PASS. Existing tests use `makeListing()` with a factory-made root category, which
is a leaf, so they are unaffected.

- [ ] **Step 9: Commit**

```bash
git add src/lib/listings-query.ts src/app/api/listings \
  src/lib/swagger-spec.json
git commit -m "feat(categories): filter by descendants, file listings on leaves only"
```

Run `node scripts/generate-swagger.mjs` before committing if the swagger block changed.

---

### Task 6: A real taxonomy in the seed

**Files:**
- Modify: `src/db/seed.ts:64-95`

**Interfaces:**
- Consumes: the schema from Task 1.
- Produces: a two-level seeded taxonomy whose leaf slugs are `smartphones`, `laptops`, `mens-clothing`, `womens-clothing`, `furniture`, `garden-tools`, `fiction`, `non-fiction`, `outdoor`, `fitness`. Listings are filed under leaves.

- [ ] **Step 1: Replace the category seeding block**

In `src/db/seed.ts`, replace from `const categoryData = [` through the
`console.log("  ✔ Categories created: …")` line:

```ts
  // ─── Categories (two levels — listings hang off leaves only) ──────────────
  const rootData = [
    { name: "Electronics", slug: "electronics", description: "Phones, laptops, gadgets and more" },
    { name: "Clothing", slug: "clothing", description: "Men's and women's apparel" },
    { name: "Home & Garden", slug: "home-garden", description: "Furniture, decor and garden tools" },
    { name: "Books", slug: "books", description: "Fiction, non-fiction and textbooks" },
    { name: "Sports", slug: "sports", description: "Sporting goods and outdoor equipment" },
  ];

  const insertedRoots = await db
    .insert(categories)
    .values(rootData.map((c, i) => ({ ...c, path: "", depth: 0, sortOrder: i })))
    .returning();

  // The path is the row's own id for a root, which is only knowable after the insert.
  for (const root of insertedRoots) {
    await db
      .update(categories)
      .set({ path: String(root.id) })
      .where(eq(categories.id, root.id));
  }

  const rootBySlug = Object.fromEntries(insertedRoots.map((c) => [c.slug, c]));

  const childData: { name: string; slug: string; parentSlug: string }[] = [
    { name: "Smartphones", slug: "smartphones", parentSlug: "electronics" },
    { name: "Laptops", slug: "laptops", parentSlug: "electronics" },
    { name: "Men's clothing", slug: "mens-clothing", parentSlug: "clothing" },
    { name: "Women's clothing", slug: "womens-clothing", parentSlug: "clothing" },
    { name: "Furniture", slug: "furniture", parentSlug: "home-garden" },
    { name: "Garden tools", slug: "garden-tools", parentSlug: "home-garden" },
    { name: "Fiction", slug: "fiction", parentSlug: "books" },
    { name: "Non-fiction", slug: "non-fiction", parentSlug: "books" },
    { name: "Outdoor", slug: "outdoor", parentSlug: "sports" },
    { name: "Fitness", slug: "fitness", parentSlug: "sports" },
  ];

  const catBySlug: Record<string, number> = {};

  for (const [index, child] of childData.entries()) {
    const parent = rootBySlug[child.parentSlug];

    const [inserted] = await db
      .insert(categories)
      .values({
        name: child.name,
        slug: child.slug,
        description: null,
        parentId: parent.id,
        path: "",
        depth: 1,
        sortOrder: index,
      })
      .returning();

    await db
      .update(categories)
      .set({ path: `${parent.id}.${inserted.id}` })
      .where(eq(categories.id, inserted.id));

    catBySlug[child.slug] = inserted.id;
  }

  console.log(
    `  ✔ Categories created: ${insertedRoots.length} roots, ${childData.length} subcategories`,
  );
```

Add `eq` to the `drizzle-orm` import at the top of `seed.ts` if it is not already there.

- [ ] **Step 2: Point the seeded listings at leaf categories**

In the `listingData` array below, replace each `categoryId` line. The six listings and
their new values, in file order:

| Line | Listing title | Old | New |
|------|---------------|-----|-----|
| 90 | `iPhone 14 Pro — excellent condition` | `catBySlug["electronics"]` | `catBySlug["smartphones"]` |
| 98 | `Dell XPS 15 Laptop` | `catBySlug["electronics"]` | `catBySlug["laptops"]` |
| 106 | `Vintage Denim Jacket — Size M` | `catBySlug["clothing"]` | `catBySlug["mens-clothing"]` |
| 114 | `IKEA KALLAX Shelf Unit` | `catBySlug["home-garden"]` | `catBySlug["furniture"]` |
| 122 | `Clean Code by Robert C. Martin` | `catBySlug["books"]` | `catBySlug["non-fiction"]` |
| 130 | `Wilson Tennis Racket` | `catBySlug["sports"]` | `catBySlug["outdoor"]` |

`catBySlug` now contains only leaf slugs, so a missed line surfaces immediately as
`categoryId: undefined` rather than silently filing a listing under a root.

- [ ] **Step 3: Run the seed against a local database**

Run: `npm run db:migrate && npm run db:seed`
Expected: the category line reads `5 roots, 10 subcategories`, and the listings insert
without a foreign-key or check error.

- [ ] **Step 4: Commit**

```bash
git add src/db/seed.ts
git commit -m "feat(categories): seed a two-level taxonomy"
```

---

### Task 7: `CategorySelect` and the listing form

**Files:**
- Create: `src/components/categories/CategorySelect.tsx`
- Create: `src/components/categories/CategorySelect.component.test.tsx`
- Modify: `src/components/listings/ListingForm.tsx` (the category `<div>`, around lines 219–241)

**Interfaces:**
- Consumes: `childrenOf`, `ancestorChain` from `@/lib/categories` (Task 2); the `Category` type from `@/types/api`.
- Produces: `<CategorySelect categories={Category[]} value={number | null} onChange={(id: number | null) => void} />`, rendering one `<select>` per level, each labelled `Category`, `Subcategory`, `Sub-subcategory`. `onChange` fires with the deepest selected id, or `null` when the top level is cleared.

- [ ] **Step 1: Write the failing test**

Create `src/components/categories/CategorySelect.component.test.tsx`:

```tsx
/**
 * Part 1 spec — the cascading category picker.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CategorySelect from "./CategorySelect";
import type { Category } from "@/types/api";

const CATEGORIES = [
  { id: 1, name: "Electronics", slug: "electronics", description: null, parentId: null, path: "1", depth: 0, sortOrder: 0 },
  { id: 2, name: "Clothing", slug: "clothing", description: null, parentId: null, path: "2", depth: 0, sortOrder: 1 },
  { id: 7, name: "Phones", slug: "phones", description: null, parentId: 1, path: "1.7", depth: 1, sortOrder: 0 },
  { id: 12, name: "Smartphones", slug: "smartphones", description: null, parentId: 7, path: "1.7.12", depth: 2, sortOrder: 0 },
] as Category[];

describe("CategorySelect", () => {
  it("offers only root categories at the top level", () => {
    render(<CategorySelect categories={CATEGORIES} value={null} onChange={vi.fn()} />);

    const top = screen.getByLabelText("Category");

    expect(within(top).getByRole("option", { name: "Electronics" })).toBeInTheDocument();
    expect(within(top).queryByRole("option", { name: "Phones" })).not.toBeInTheDocument();
  });

  it("reveals the next level once a parent with children is chosen", async () => {
    const onChange = vi.fn();
    render(<CategorySelect categories={CATEGORIES} value={null} onChange={onChange} />);

    expect(screen.queryByLabelText("Subcategory")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Category"), "1");

    expect(onChange).toHaveBeenCalledWith(1);
    expect(screen.getByLabelText("Subcategory")).toBeInTheDocument();
  });

  it("shows no deeper select for a root with no children", async () => {
    const onChange = vi.fn();
    render(<CategorySelect categories={CATEGORIES} value={null} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText("Category"), "2");

    expect(onChange).toHaveBeenCalledWith(2);
    expect(screen.queryByLabelText("Subcategory")).not.toBeInTheDocument();
  });

  it("prefills every level from an existing deep value", () => {
    render(<CategorySelect categories={CATEGORIES} value={12} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Category")).toHaveValue("1");
    expect(screen.getByLabelText("Subcategory")).toHaveValue("7");
    expect(screen.getByLabelText("Sub-subcategory")).toHaveValue("12");
  });

  it("clears deeper levels when a higher one changes", async () => {
    const onChange = vi.fn();
    render(<CategorySelect categories={CATEGORIES} value={12} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText("Category"), "2");

    // Selecting a different root cannot leave the old grandchild selected underneath it.
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(screen.queryByLabelText("Subcategory")).not.toBeInTheDocument();
  });

  it("reports null when the top level is cleared", async () => {
    const onChange = vi.fn();
    render(<CategorySelect categories={CATEGORIES} value={1} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText("Category"), "");

    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
```

Add `within` to the Testing Library import:

```tsx
import { render, screen, within } from "@testing-library/react";
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:component -- src/components/categories/CategorySelect.component.test.tsx`
Expected: FAIL — cannot resolve `./CategorySelect`.

- [ ] **Step 3: Write the component**

Create `src/components/categories/CategorySelect.tsx`:

```tsx
"use client";

import { MAX_CATEGORY_DEPTH, ancestorChain, childrenOf } from "@/lib/categories";
import type { Category } from "@/types/api";

const LEVEL_LABELS = ["Category", "Subcategory", "Sub-subcategory"];

const selectClasses =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20";

export type CategorySelectProps = {
  categories: Category[];
  /** The deepest selected category, or null. */
  value: number | null;
  onChange: (id: number | null) => void;
};

/**
 * Cascading selects over the category tree.
 *
 * The component holds no state of its own: the selected chain is derived from `value`
 * via the stored path. Keeping a parallel copy of the selection in state is how a picker
 * like this ends up disagreeing with the form it belongs to.
 */
export default function CategorySelect({
  categories,
  value,
  onChange,
}: CategorySelectProps) {
  const chain = value === null ? [] : ancestorChain(categories, value);

  // One select per already-chosen level, plus one for the next choice if the deepest
  // selection still has children and we are not at the cap.
  const levels: { parentId: number | null; selected: number | null }[] = [];

  for (let depth = 0; depth < MAX_CATEGORY_DEPTH; depth++) {
    const parentId = depth === 0 ? null : (chain[depth - 1]?.id ?? null);

    // A level beyond the chosen chain only exists if its parent was chosen.
    if (depth > 0 && chain[depth - 1] === undefined) break;
    if (childrenOf(categories, parentId).length === 0) break;

    levels.push({ parentId, selected: chain[depth]?.id ?? null });
  }

  function handleChange(depth: number, raw: string) {
    // Changing any level discards everything below it: the old deeper selection is not
    // a descendant of the new choice.
    onChange(raw === "" ? (depth === 0 ? null : (chain[depth - 1]?.id ?? null)) : Number(raw));
  }

  return (
    <div className="flex flex-col gap-3">
      {levels.map((level, depth) => {
        const id = `listing-category-${depth}`;
        const options = childrenOf(categories, level.parentId);

        return (
          <div key={id} className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700" htmlFor={id}>
              {LEVEL_LABELS[depth]}
            </label>
            <select
              id={id}
              className={selectClasses}
              value={level.selected === null ? "" : String(level.selected)}
              onChange={(event) => handleChange(depth, event.target.value)}
            >
              <option value="">
                {depth === 0 ? "No category" : `All ${LEVEL_LABELS[depth].toLowerCase()}`}
              </option>
              {options.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm run test:component -- src/components/categories/CategorySelect.component.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into the listing form**

In `src/components/listings/ListingForm.tsx`:

Change the category state from a string to a number-or-null:

```tsx
  const [categoryId, setCategoryId] = useState<number | null>(null);
```

In the prefill effect, replace the category line:

```tsx
    setCategoryId(listing.categoryId ?? null);
```

In `handleSubmit`, replace the `categoryId` line in `payload`:

```tsx
      categoryId,
```

Replace the whole category `<div>` (the `<label htmlFor="listing-category">` block and its
`<select>`) with:

```tsx
        <CategorySelect
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
        />
```

Add the import:

```tsx
import CategorySelect from "@/components/categories/CategorySelect";
```

- [ ] **Step 6: Run the form's own tests**

Run: `npm run test:component -- src/components/listings/ListingForm.component.test.tsx`
Expected: PASS, unchanged.

The suite's `useFetch` mock returns `[]` for `/api/categories` (see its comment at line
35), so no test ever drove the old `<select>` and none needs editing. If a test does fail,
it is asserting on the removed `listing-category` element — replace that query with
`screen.getByLabelText("Category")` and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/components/categories/CategorySelect.tsx \
  src/components/categories/CategorySelect.component.test.tsx \
  src/components/listings/ListingForm.tsx \
  src/components/listings/ListingForm.component.test.tsx
git commit -m "feat(categories): cascading category picker in the listing form"
```

---

### Task 8: `CategoryTreeFilter` and the browse page

**Files:**
- Create: `src/components/categories/CategoryTreeFilter.tsx`
- Create: `src/components/categories/CategoryTreeFilter.component.test.tsx`
- Modify: `src/app/(frontend)/listings/page.tsx` (the category filter control and `categoryMap`)

**Interfaces:**
- Consumes: `buildCategoryTree` from `@/lib/categories` (Task 2).
- Produces: `<CategoryTreeFilter categories={Category[]} value={number | null} onChange={(id: number | null) => void} />` — a nested list of buttons, with the selected one marked `aria-current="true"`.

- [ ] **Step 1: Write the failing test**

Create `src/components/categories/CategoryTreeFilter.component.test.tsx`:

```tsx
/**
 * Part 1 spec — the browse-page category tree.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CategoryTreeFilter from "./CategoryTreeFilter";
import type { Category } from "@/types/api";

const CATEGORIES = [
  { id: 1, name: "Electronics", slug: "electronics", description: null, parentId: null, path: "1", depth: 0, sortOrder: 0 },
  { id: 2, name: "Clothing", slug: "clothing", description: null, parentId: null, path: "2", depth: 0, sortOrder: 1 },
  { id: 7, name: "Phones", slug: "phones", description: null, parentId: 1, path: "1.7", depth: 1, sortOrder: 0 },
] as Category[];

describe("CategoryTreeFilter", () => {
  it("renders every category, nested", () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Electronics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phones" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clothing" })).toBeInTheDocument();
  });

  it("reports the chosen category", async () => {
    const onChange = vi.fn();
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Phones" }));

    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("marks the selected category", () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={7} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Phones" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Electronics" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("clears the filter through All categories", async () => {
    const onChange = vi.fn();
    render(<CategoryTreeFilter categories={CATEGORIES} value={7} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "All categories" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:component -- src/components/categories/CategoryTreeFilter.component.test.tsx`
Expected: FAIL — cannot resolve `./CategoryTreeFilter`.

- [ ] **Step 3: Write the component**

Create `src/components/categories/CategoryTreeFilter.tsx`:

```tsx
"use client";

import { buildCategoryTree, type CategoryTreeNode } from "@/lib/categories";
import type { Category } from "@/types/api";

export type CategoryTreeFilterProps = {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
};

function itemClasses(selected: boolean): string {
  return [
    "w-full rounded-lg px-2 py-1 text-left text-sm transition-colors",
    selected
      ? "bg-indigo-50 font-medium text-indigo-700"
      : "text-zinc-700 hover:bg-zinc-100",
  ].join(" ");
}

function Branch({
  nodes,
  value,
  onChange,
}: {
  nodes: CategoryTreeNode<Category>[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            className={itemClasses(node.id === value)}
            // aria-current rather than a class alone: the selection has to be reachable
            // by a screen reader, not only visible.
            aria-current={node.id === value ? "true" : undefined}
            onClick={() => onChange(node.id)}
          >
            {node.name}
          </button>
          {node.children.length > 0 && (
            <div className="ml-3 border-l border-zinc-200 pl-2">
              <Branch nodes={node.children} value={value} onChange={onChange} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The browse filter.
 *
 * Choosing a parent filters by the parent *and everything under it* — the server does
 * that expansion (spec §3.3), so this component only reports an id.
 */
export default function CategoryTreeFilter({
  categories,
  value,
  onChange,
}: CategoryTreeFilterProps) {
  const tree = buildCategoryTree(categories);

  return (
    <nav aria-label="Categories" className="flex flex-col gap-1">
      <button
        type="button"
        className={itemClasses(value === null)}
        aria-current={value === null ? "true" : undefined}
        onClick={() => onChange(null)}
      >
        All categories
      </button>
      <Branch nodes={tree} value={value} onChange={onChange} />
    </nav>
  );
}
```

Export the type from `src/lib/categories.ts` if it is not already exported — it is, as
`CategoryTreeNode`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm run test:component -- src/components/categories/CategoryTreeFilter.component.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into the browse page**

In `src/app/(frontend)/listings/page.tsx`:

Change the filter state to a number-or-null, parsed from the URL:

```tsx
  const [categoryId, setCategoryId] = useState<number | null>(() => {
    const raw = searchParams.get("categoryId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
```

In the `query` memo, replace the `categoryId` line:

```tsx
    if (categoryId !== null) params.set("categoryId", String(categoryId));
```

Replace the existing category `<select>` control with:

```tsx
              <CategoryTreeFilter
                categories={categories}
                value={categoryId}
                onChange={(id) => {
                  setCategoryId(id);
                  setPage(1);
                }}
              />
```

Resetting to page 1 matters: filtering to a narrower branch while on page 4 otherwise
shows an empty grid.

Add the import:

```tsx
import CategoryTreeFilter from "@/components/categories/CategoryTreeFilter";
```

`categoryMap` is still used to label listing cards and needs no change — it maps every
category id to a name regardless of depth.

- [ ] **Step 6: Run the browse page tests**

Run: `npm run test:component -- "src/app/(frontend)/listings/page.component.test.tsx"`
Expected: PASS, unchanged.

Its `useFetch` mock also returns `[]` for `/api/categories` (line 36), so the filter
renders only the "All categories" button and no existing assertion touches it. If a test
does fail, replace its `<select>` interaction with
`await userEvent.click(screen.getByRole("button", { name: "Electronics" }))`.

- [ ] **Step 7: Commit**

```bash
git add src/components/categories/CategoryTreeFilter.tsx \
  src/components/categories/CategoryTreeFilter.component.test.tsx \
  "src/app/(frontend)/listings/page.tsx" \
  "src/app/(frontend)/listings/page.component.test.tsx"
git commit -m "feat(categories): tree filter on the browse page"
```

---

### Task 9: `CategoryBreadcrumb` on the detail page

**Files:**
- Create: `src/components/categories/CategoryBreadcrumb.tsx`
- Create: `src/components/categories/CategoryBreadcrumb.component.test.tsx`
- Modify: `src/app/(frontend)/listings/[id]/page.tsx:58-65` (the `categoryName` memo and its render site)

**Interfaces:**
- Consumes: `ancestorChain` from `@/lib/categories` (Task 2).
- Produces: `<CategoryBreadcrumb categories={Category[]} categoryId={number | null} />`, rendering a `nav` labelled `Category` whose links point at `/listings?categoryId=<id>`.

- [ ] **Step 1: Write the failing test**

Create `src/components/categories/CategoryBreadcrumb.component.test.tsx`:

```tsx
/**
 * Part 1 spec — the ancestor breadcrumb on a listing.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CategoryBreadcrumb from "./CategoryBreadcrumb";
import type { Category } from "@/types/api";

const CATEGORIES = [
  { id: 1, name: "Electronics", slug: "electronics", description: null, parentId: null, path: "1", depth: 0, sortOrder: 0 },
  { id: 7, name: "Phones", slug: "phones", description: null, parentId: 1, path: "1.7", depth: 1, sortOrder: 0 },
  { id: 12, name: "Smartphones", slug: "smartphones", description: null, parentId: 7, path: "1.7.12", depth: 2, sortOrder: 0 },
] as Category[];

describe("CategoryBreadcrumb", () => {
  it("renders the whole chain root-first", () => {
    render(<CategoryBreadcrumb categories={CATEGORIES} categoryId={12} />);

    const links = screen.getAllByRole("link");

    expect(links.map((l) => l.textContent)).toEqual([
      "Electronics",
      "Phones",
      "Smartphones",
    ]);
  });

  it("links each ancestor to a filtered browse", () => {
    render(<CategoryBreadcrumb categories={CATEGORIES} categoryId={12} />);

    expect(screen.getByRole("link", { name: "Electronics" })).toHaveAttribute(
      "href",
      "/listings?categoryId=1",
    );
  });

  it("says Uncategorized when the listing has no category", () => {
    render(<CategoryBreadcrumb categories={CATEGORIES} categoryId={null} />);

    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("says Uncategorized when the category list has not loaded yet", () => {
    // The page fetches listing and categories separately; the first render has one and
    // not the other, and that must not throw.
    render(<CategoryBreadcrumb categories={[]} categoryId={12} />);

    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:component -- src/components/categories/CategoryBreadcrumb.component.test.tsx`
Expected: FAIL — cannot resolve `./CategoryBreadcrumb`.

- [ ] **Step 3: Write the component**

Create `src/components/categories/CategoryBreadcrumb.tsx`:

```tsx
import Link from "next/link";

import { ancestorChain } from "@/lib/categories";
import type { Category } from "@/types/api";

export type CategoryBreadcrumbProps = {
  categories: Category[];
  categoryId: number | null;
};

/**
 * Where a listing sits in the taxonomy, root first.
 *
 * Every crumb links to a filtered browse, and since filtering by an ancestor includes
 * its descendants (spec §3.3), "Electronics" genuinely means everything electronic.
 */
export default function CategoryBreadcrumb({
  categories,
  categoryId,
}: CategoryBreadcrumbProps) {
  const chain = categoryId === null ? [] : ancestorChain(categories, categoryId);

  // Either the listing has no category, or the category list has not arrived yet. Both
  // render the same thing rather than an empty gap.
  if (chain.length === 0) {
    return <span className="text-sm text-zinc-500">Uncategorized</span>;
  }

  return (
    <nav aria-label="Category" className="flex flex-wrap items-center gap-1 text-sm">
      {chain.map((category, index) => (
        <span key={category.id} className="flex items-center gap-1">
          {index > 0 && <span className="text-zinc-300">›</span>}
          <Link
            href={`/listings?categoryId=${category.id}`}
            className="text-indigo-600 hover:underline"
          >
            {category.name}
          </Link>
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm run test:component -- src/components/categories/CategoryBreadcrumb.component.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into the detail page**

In `src/app/(frontend)/listings/[id]/page.tsx`, delete the `categoryName` memo (lines
58–65) and replace whatever renders `categoryName` with:

```tsx
            <CategoryBreadcrumb
              categories={categoryData ?? []}
              categoryId={listing.categoryId}
            />
```

Add the import:

```tsx
import CategoryBreadcrumb from "@/components/categories/CategoryBreadcrumb";
```

Remove `useMemo` from the React import if nothing else in the file uses it.

- [ ] **Step 6: Run the full suite**

Run: `npm run test:unit && npm run test:component`
Expected: PASS.

Run: `npm run test:integration`
Expected: PASS. Requires Docker for Testcontainers; if Docker is unavailable, say so
rather than reporting a pass.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/categories/CategoryBreadcrumb.tsx \
  src/components/categories/CategoryBreadcrumb.component.test.tsx \
  "src/app/(frontend)/listings/[id]/page.tsx"
git commit -m "feat(categories): breadcrumb on the listing detail page"
```

---

## Done when

- `npm run test:unit`, `npm run test:component` and `npm run test:integration` all pass.
- `npx tsc --noEmit` exits 0.
- `npm run db:migrate && npm run db:seed` produces a two-level taxonomy with listings on leaves.
- `GET /api/listings?categoryId=<root>` returns listings filed under that root's grandchildren.
- `GET /api/categories` still returns a flat array, now with `parentId`, `path`, `depth` and `sortOrder`.
