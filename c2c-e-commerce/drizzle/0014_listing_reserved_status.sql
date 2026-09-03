-- Part 3 of the 2026-08-30 redesign — a listing can be held.
--
-- A listing between "someone has claimed this" and "the seller has decided" is neither
-- `active` nor `sold`. Without a name for that state the only way to stop a second buyer
-- is a lock, and a lock serialises the writes without preventing the second sale.
--
-- A type swap, not `ALTER TYPE ... ADD VALUE` as 0012 used for `draft`, because 0015's
-- backfill has to *write* this value. Postgres refuses to use an enum value in the same
-- transaction that added it (55P04, "New enum values must be committed before they can
-- be used"), and Drizzle's migrator runs every pending migration inside one transaction
-- — so splitting the two into separate files does not separate the transactions. Values
-- of a type *created* in the current transaction are exempt from that rule, which is
-- what makes the swap work where ADD VALUE cannot. 0015 swaps `order_status` the same
-- way, for a different reason.
--
-- `reserved` sits between `active` and `sold` in the declaration so the enum's order
-- follows the lifecycle. Nothing sorts or compares on it today; this is for the reader.

ALTER TABLE "listings" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
CREATE TYPE "listing_status_new" AS ENUM (
  'draft', 'active', 'reserved', 'sold', 'removed'
);
--> statement-breakpoint
ALTER TABLE "listings"
  ALTER COLUMN "status" TYPE "listing_status_new"
  USING ("status"::text)::"listing_status_new";
--> statement-breakpoint
DROP TYPE "listing_status";
--> statement-breakpoint
ALTER TYPE "listing_status_new" RENAME TO "listing_status";
--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "status" SET DEFAULT 'active';
