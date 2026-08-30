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

-- One line becomes one order priced at that line's *unit* price, so a line with
-- `quantity > 1` would migrate to an order worth a fraction of what was owed — and 0016
-- drops `total_price`, which is the only surviving record of the real figure. The UI has
-- never sent a quantity, so this should find nothing; an irreversible migration must not
-- assume that silently. Refuse to run rather than lose money nobody can reconstruct.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "order_items" WHERE "quantity" <> 1) THEN
    RAISE EXCEPTION 'order_items rows with quantity <> 1 cannot be collapsed losslessly; reconcile them by hand before migrating';
  END IF;
END $$;
--> statement-breakpoint
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
-- ─── Settling what the old double-sell left behind ───────────────────────────
--
-- The next three statements clean up a specific historical bug, not policy. Before this
-- part, a listing became `sold` only when its *seller* approved the order: the old
-- handler gated the side effect on `payload.role === 'seller'`. An admin approval, and
-- any order an admin set to `paid`, left the listing `active` — so the same listing
-- could be claimed again, and the database can hold several live orders for one physical
-- object. The new code cannot produce that shape (`claimListing` serialises on the
-- listing row), but it must not be built on top of it: `applyListingSideEffect` is
-- conditional on the status it expects to find, so on such data a second confirmation
-- silently does nothing, and declining a leftover duplicate un-sells a completed sale.
--
-- Order matters. Each statement assumes the one before it has run.

-- A pending order on a listing that also carries a confirmed, shipped or completed one
-- is the residue: that sale already happened, and this buyer was never going to get the
-- object. Expiry is the existing name for "this reservation came to nothing".
UPDATE "orders" o
   SET "status" = 'expired', "updated_at" = now()
 WHERE o."status" = 'pending'
   AND EXISTS (
     SELECT 1 FROM "orders" s
      WHERE s."listing_id" = o."listing_id"
        AND s."status" IN ('confirmed', 'shipped', 'completed')
   );
--> statement-breakpoint
-- Two pending orders on one listing was the bug's ordinary output — nobody had decided
-- yet, so neither is more real than the other. The earliest claim wins, which is the
-- rule the new reservation path enforces; the rest expire.
UPDATE "orders"
   SET "status" = 'expired', "updated_at" = now()
 WHERE "id" IN (
   SELECT ranked."id"
     FROM (
       SELECT "id",
              row_number() OVER (
                PARTITION BY "listing_id" ORDER BY "created_at", "id"
              ) AS rn
         FROM "orders"
        WHERE "status" = 'pending'
     ) ranked
    WHERE ranked.rn > 1
 );
--> statement-breakpoint
-- A confirmed or shipped order means the seller agreed to the sale, whoever recorded the
-- approval. The listing that order holds is sold, and leaving it in browse is how a
-- second buyer reserves an object that is already gone.
UPDATE "listings" SET "status" = 'sold'
 WHERE "status" IN ('active', 'reserved')
   AND EXISTS (
     SELECT 1 FROM "orders"
      WHERE "orders"."listing_id" = "listings"."id"
        AND "orders"."status" IN ('confirmed', 'shipped')
   );
--> statement-breakpoint
-- Listings a live pending order is holding become `reserved`. Without this, every
-- in-flight purchase at deploy time would leave its listing back in browse, which is the
-- double-sell this part exists to close.
--
-- It runs last of the four, so by now the only pending order it can see on a listing is
-- that listing's sole live order.
UPDATE "listings" SET "status" = 'reserved'
 WHERE "status" = 'active'
   AND EXISTS (
     SELECT 1 FROM "orders"
      WHERE "orders"."listing_id" = "listings"."id"
        AND "orders"."status"     = 'pending'
        AND "orders"."expires_at" > now()
   );
--> statement-breakpoint
-- One live order per listing, enforced rather than hoped for. `claimListing` already
-- serialises new orders on the listing row, so this cannot false-positive on data this
-- code produced; it exists to refuse to build on data the old double-sell produced.
-- Terminal orders are excluded because a listing may accumulate any number of them, and
-- `completed` is excluded because an admin may return a sold listing to browse.
--
-- The cleanup above resolves every duplicate a migration can resolve on its own. What it
-- deliberately does not touch is two *confirmed* orders on one listing: money changed
-- hands twice there, and choosing which buyer to disappoint is not a decision SQL gets to
-- make. On such a database this index fails to build and the migration stops, which is
-- the correct outcome.
CREATE UNIQUE INDEX "orders_one_live_per_listing_idx"
  ON "orders" ("listing_id")
  WHERE "status" IN ('pending', 'confirmed', 'shipped');
