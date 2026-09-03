-- C2C-SEC-5 — external identities.
--
-- The unique key is (provider, provider_account_id), not the email: a provider's
-- account id is stable, while the address behind it can be changed by the user at any
-- time. Keying on email would let someone change their address at the provider and
-- collide with -- or silently detach from -- an existing link.

DO $$ BEGIN
  CREATE TYPE "public"."oauth_provider" AS ENUM('google', 'github');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "user_id"             integer NOT NULL,
  "provider"            "oauth_provider" NOT NULL,
  "provider_account_id" text NOT NULL,
  "provider_email"      text,
  "created_at"          timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "oauth_accounts"
  ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_accounts_provider_account_idx"
  ON "oauth_accounts" USING btree ("provider", "provider_account_id");
