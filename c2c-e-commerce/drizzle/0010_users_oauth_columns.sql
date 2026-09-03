-- C2C-SEC-5 — make room for accounts that have no password.
--
-- email_verified backfills to false for every existing row, deliberately. Those users
-- registered with a password and this app has never run an email verification flow;
-- defaulting them to true would be a claim we cannot support, and SEC-8's account
-- linking policy trusts this column to decide whether a collision may be linked.

ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verified" boolean DEFAULT false NOT NULL;

--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" text;
