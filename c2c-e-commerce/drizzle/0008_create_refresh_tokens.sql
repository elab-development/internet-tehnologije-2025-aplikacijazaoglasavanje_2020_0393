-- C2C-SEC-2 — rotating refresh tokens.
--
-- token_hash holds a SHA-256 digest, never the token itself: leaking this table must
-- not leak live sessions.
--
-- family_id ties every token descended from one login together, which is what lets a
-- replayed token revoke the whole chain (SEC-3 reuse detection).

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id"             serial PRIMARY KEY NOT NULL,
  "user_id"        integer NOT NULL,
  "token_hash"     text NOT NULL,
  "family_id"      uuid NOT NULL,
  "issued_at"      timestamp DEFAULT now() NOT NULL,
  "expires_at"     timestamp NOT NULL,
  "revoked_at"     timestamp,
  "replaced_by_id" integer,
  "user_agent"     text,
  "ip"             text
);

--> statement-breakpoint
-- Deleting a user must not leave their sessions behind.
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint
-- Self-reference: the token this one was rotated into. ON DELETE SET NULL so pruning an
-- ancient successor cannot orphan-block its predecessor's removal.
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_replaced_by_id_refresh_tokens_id_fk"
  FOREIGN KEY ("replaced_by_id") REFERENCES "public"."refresh_tokens"("id")
  ON DELETE set null ON UPDATE no action;

--> statement-breakpoint
-- The lookup on every refresh, and the constraint that stops the same hash existing twice.
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_hash_idx"
  ON "refresh_tokens" USING btree ("token_hash");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx"
  ON "refresh_tokens" USING btree ("user_id");

--> statement-breakpoint
-- Revoking a family is on the security-critical path; it must not table-scan.
CREATE INDEX IF NOT EXISTS "refresh_tokens_family_id_idx"
  ON "refresh_tokens" USING btree ("family_id");
