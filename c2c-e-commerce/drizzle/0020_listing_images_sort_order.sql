-- `nextSortOrder` is a read-then-write: two concurrent uploads to one listing both read
-- the same MAX and both write it back, so they collide and the cover image becomes
-- whichever id happens to sort first. Task 9 serialises the writers with a row lock; this
-- index is the backstop that makes the collision unrepresentable rather than merely
-- unlikely -- the same shape as orders_one_live_per_listing_idx and
-- reviews_one_per_order_idx.
DO $$
DECLARE
  duplicates integer;
BEGIN
  SELECT count(*) INTO duplicates FROM (
    SELECT "listing_id", "sort_order"
      FROM "listing_images"
     GROUP BY "listing_id", "sort_order"
    HAVING count(*) > 1
  ) AS d;

  IF duplicates > 0 THEN
    RAISE NOTICE 'Renumbering % duplicated (listing_id, sort_order) pair(s).', duplicates;
  END IF;
END $$;

-- Deterministic by id, so a re-run produces the same order and the existing cover image
-- (lowest sort_order, then lowest id) keeps its place wherever it already won.
WITH renumbered AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "listing_id" ORDER BY "sort_order", "id") - 1
           AS "new_sort_order"
    FROM "listing_images"
)
UPDATE "listing_images" li
   SET "sort_order" = r."new_sort_order"
  FROM renumbered r
 WHERE li."id" = r."id"
   AND li."sort_order" <> r."new_sort_order";

CREATE UNIQUE INDEX "listing_images_listing_sort_idx"
    ON "listing_images" ("listing_id", "sort_order");
