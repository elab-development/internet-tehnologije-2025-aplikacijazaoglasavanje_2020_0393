-- Part 3 of the 2026-08-30 redesign — remove the join table.
--
-- IRREVERSIBLE. 0015 copied every line into an order of its own, so nothing here is lost
-- that 0015 did not already preserve; but the table itself cannot come back, and a
-- database that has run this cannot run the old code.
--
-- Deliberately separate from 0015 (spec §8): every consumer of `order_items` had to move
-- to `orders.listing_id` first, and dropping it in the additive migration would have left
-- the tree broken between tasks.

DROP TABLE IF EXISTS "order_items";
--> statement-breakpoint
-- With one listing per order, the price is the total. `total_price` has been nullable and
-- unwritten since 0015.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "total_price";
