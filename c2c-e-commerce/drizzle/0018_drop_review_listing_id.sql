-- Part 4 — the listing is reachable through the order now.
--
-- Deliberately separate from 0017 (spec §8, and the shape 0015/0016 used): every consumer
-- had to move to `order_id` first, and dropping the column in the additive migration would
-- have left the tree broken between tasks.
--
-- Recoverable in principle — `reviews.order_id -> orders.listing_id` gives the same value
-- back — but the column itself does not return, and a database that has run this cannot
-- run the code that read it.

ALTER TABLE "reviews" DROP COLUMN IF EXISTS "listing_id";
