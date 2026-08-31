-- Part 4 of the 2026-08-30 redesign — reviews are about the seller, not the listing (D6).
--
-- A review attached to a listing is stranded the moment that listing sells, which for
-- one-off second-hand goods is immediately. Anchoring it to the order moves the subject
-- to the person and makes the transaction the uniqueness key.
--
-- ADDITIVE ON PURPOSE. `reviews.listing_id` survives this migration, nullable and
-- unwritten, so the tree keeps compiling while each consumer moves to `order_id`. 0018
-- drops it. Dropping it here would break every reader at once — the defect that cost
-- Part 1 a fix round.
--
-- PARTLY REVERSIBLE (spec §8). `listing_id` is derivable back through the order, but the
-- deletions below are not: a review with no order behind it has nothing to attach to in
-- the new model.

ALTER TABLE "users"
  ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "rating_sum" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "reviews"
  ADD COLUMN "seller_id" integer,
  ADD COLUMN "order_id" integer;
--> statement-breakpoint
-- The subject comes from the listing that was reviewed.
UPDATE "reviews" AS r
   SET "seller_id" = l."seller_id"
  FROM "listings" AS l
 WHERE l."id" = r."listing_id";
--> statement-breakpoint
-- The transaction comes from the reviewer's own order for that listing.
--
-- Spec §6.5 says "earliest". Taken literally, a buyer who cancelled once and completed
-- later would have their review anchored to the cancelled transaction — a review of
-- something that never happened, which the new eligibility rule would then say should not
-- exist. Ordering by `status <> 'completed'` first puts a completed order ahead of every
-- other, and the spec's earliest-wins rule decides the rest.
UPDATE "reviews" AS r
   SET "order_id" = o."id"
  FROM (
    SELECT DISTINCT ON ("buyer_id", "listing_id")
           "id", "buyer_id", "listing_id"
      FROM "orders"
     ORDER BY "buyer_id", "listing_id", ("status" <> 'completed'), "created_at", "id"
  ) AS o
 WHERE o."buyer_id" = r."reviewer_id"
   AND o."listing_id" = r."listing_id";
--> statement-breakpoint
-- Two reviews by one buyer of one listing map to the same order, and a unique index
-- cannot hold both. The old duplicate check was a SELECT followed by an INSERT, which is
-- exactly the check two concurrent posts both pass — so this is not hypothetical. Keep
-- the earliest; it is the one the buyer wrote first.
DELETE FROM "reviews" AS r
 USING "reviews" AS other
 WHERE r."order_id" IS NOT NULL
   AND other."order_id" = r."order_id"
   AND (other."created_at", other."id") < (r."created_at", r."id");
--> statement-breakpoint
-- Anything still unanchored has no order behind it. Announce the count rather than
-- dropping rows in silence (spec §6.5).
DO $$
DECLARE orphaned integer;
BEGIN
  SELECT count(*) INTO orphaned
    FROM "reviews"
   WHERE "order_id" IS NULL OR "seller_id" IS NULL;

  IF orphaned > 0 THEN
    RAISE NOTICE '0017: deleting % review(s) with no matching order', orphaned;
  END IF;
END $$;
--> statement-breakpoint
DELETE FROM "reviews" WHERE "order_id" IS NULL OR "seller_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "reviews"
  ALTER COLUMN "seller_id" SET NOT NULL,
  ALTER COLUMN "order_id" SET NOT NULL,
  -- Nullable from here on. Nothing writes it; 0018 removes it.
  ALTER COLUMN "listing_id" DROP NOT NULL;
--> statement-breakpoint
-- CASCADE on both, matching `reviews_reviewer_id_users_id_fk`: deleting a user or an
-- order takes the reviews that describe it. The RBAC matrix records this as a known,
-- deferred consequence of `DELETE /api/users/{id}`.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_seller_id_users_id_fk"
    FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  ADD CONSTRAINT "reviews_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade;
--> statement-breakpoint
-- One review per transaction, structurally. This is the constraint the whole re-anchor is
-- for: the API's duplicate check can now be a caught violation rather than a race.
CREATE UNIQUE INDEX "reviews_one_per_order_idx" ON "reviews" ("order_id");
--> statement-breakpoint
-- `GET /api/users/{id}/reviews` is the one read that matters here and it filters on this.
CREATE INDEX "reviews_seller_id_idx" ON "reviews" ("seller_id");
--> statement-breakpoint
-- Derived once here, maintained by every write afterwards (D7). In SQL rather than a Node
-- script so it shares the transaction with the column that makes it possible (spec §8).
UPDATE "users" AS u
   SET "review_count" = agg."count",
       "rating_sum"   = agg."sum"
  FROM (
    SELECT "seller_id", count(*) AS "count", sum("rating") AS "sum"
      FROM "reviews"
     GROUP BY "seller_id"
  ) AS agg
 WHERE agg."seller_id" = u."id";
