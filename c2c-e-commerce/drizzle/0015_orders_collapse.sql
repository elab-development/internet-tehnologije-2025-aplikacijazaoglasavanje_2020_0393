-- Part 3 of the 2026-08-30 redesign — one order, one listing (D1).
--
-- `order_items` existed for a cart that was never built. One call site, `quantity` never
-- sent, and the join is where the authorisation complexity came from: the SEC-10
-- ownership bug lived in exactly that reconciliation.
--
-- ADDITIVE ON PURPOSE. `order_items` and `orders.total_price` survive this migration so
-- the tree keeps compiling while each consumer moves to the new columns. 0016 drops
-- them. Dropping them here would break every reader at once — the defect that cost
-- Part 1 a fix round.
--
-- The status change is a type swap rather than ALTER TYPE ... ADD VALUE, because
-- Postgres cannot drop an enum value at all and `paid`, `approved` and `rejected` must
-- not survive as reachable states.

CREATE TYPE "order_status_new" AS ENUM (
  'pending', 'confirmed', 'shipped', 'completed', 'cancelled', 'declined', 'expired'
);
--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN "listing_id" integer,
  ADD COLUMN "seller_id" integer,
  ADD COLUMN "price" numeric(10,2),
  ADD COLUMN "expires_at" timestamp,
  ADD COLUMN "updated_at" timestamp;
--> statement-breakpoint
-- Split every line beyond the first into an order of its own. The current UI cannot
-- produce a multi-line order; production data may hold one, and silently keeping only
-- its first line would lose a real transaction.
INSERT INTO "orders" (
  "buyer_id", "total_price", "status", "created_at",
  "listing_id", "seller_id", "price", "expires_at", "updated_at"
)
SELECT o."buyer_id", i."price", o."status", o."created_at",
       i."listing_id", l."seller_id", i."price",
       o."created_at" + interval '48 hours', o."created_at"
  FROM (
    SELECT "id", "order_id", "listing_id", "price",
           row_number() OVER (PARTITION BY "order_id" ORDER BY "id") AS rn
      FROM "order_items"
  ) i
  JOIN "orders"   o ON o."id" = i."order_id"
  JOIN "listings" l ON l."id" = i."listing_id"
 WHERE i.rn > 1;
--> statement-breakpoint
-- Fill the original rows from their first line. New rows inserted above cannot match:
-- their ids do not appear in order_items.
UPDATE "orders" o
   SET "listing_id" = f."listing_id",
       "seller_id"  = f."seller_id",
       "price"      = f."price",
       "expires_at" = o."created_at" + interval '48 hours',
       "updated_at" = o."created_at"
  FROM (
    SELECT DISTINCT ON (i."order_id")
           i."order_id", i."listing_id", i."price", l."seller_id"
      FROM "order_items" i
      JOIN "listings" l ON l."id" = i."listing_id"
     ORDER BY i."order_id", i."id"
  ) f
 WHERE o."id" = f."order_id";
--> statement-breakpoint
-- An order with no lines describes no transaction. Nothing can be recovered from it, and
-- every new column below is about to become NOT NULL.
DELETE FROM "orders" WHERE "listing_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "orders"
  ALTER COLUMN "status" TYPE "order_status_new"
  USING (
    CASE "status"::text
      WHEN 'approved' THEN 'confirmed'
      WHEN 'rejected' THEN 'declined'
      -- No flow ever set `paid`; anything holding it was approved and nothing else.
      WHEN 'paid'     THEN 'confirmed'
      ELSE "status"::text
    END
  )::"order_status_new";
--> statement-breakpoint
DROP TYPE "order_status";
--> statement-breakpoint
ALTER TYPE "order_status_new" RENAME TO "order_status";
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "orders"
  ALTER COLUMN "listing_id" SET NOT NULL,
  ALTER COLUMN "seller_id"  SET NOT NULL,
  ALTER COLUMN "price"      SET NOT NULL,
  ALTER COLUMN "expires_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint
-- RESTRICT, not CASCADE: deleting a listing somebody bought would delete the record of
-- the purchase. Listings leave the marketplace by status, never by DELETE.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_listing_id_listings_id_fk"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_seller_id_users_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Not dropped yet, but no longer required: new writers ignore it, old readers still see
-- what they wrote. 0016 removes the column.
ALTER TABLE "orders" ALTER COLUMN "total_price" DROP NOT NULL;
--> statement-breakpoint
-- The seller dashboard's entire query, now that it is a column filter.
CREATE INDEX IF NOT EXISTS "orders_seller_id_idx"
  ON "orders" ("seller_id", "created_at" DESC);
--> statement-breakpoint
-- The reservation path's two lookups: expire this listing's stale orders, then ask
-- whether anything pending still holds it.
CREATE INDEX IF NOT EXISTS "orders_listing_id_status_idx"
  ON "orders" ("listing_id", "status");
--> statement-breakpoint
-- Listings a live pending order is holding become `reserved`. Without this, every
-- in-flight purchase at deploy time would leave its listing back in browse, which is the
-- double-sell this part exists to close.
UPDATE "listings" SET "status" = 'reserved'
 WHERE "status" = 'active'
   AND EXISTS (
     SELECT 1 FROM "orders"
      WHERE "orders"."listing_id" = "listings"."id"
        AND "orders"."status"     = 'pending'
        AND "orders"."expires_at" > now()
   );
