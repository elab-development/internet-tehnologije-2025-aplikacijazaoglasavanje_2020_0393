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
