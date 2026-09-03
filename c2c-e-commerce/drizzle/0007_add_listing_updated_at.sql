-- C2C-AI-4 — track when a listing's text last changed.
--
-- Hand-written, like 0005 and 0006, so it can carry the backfill of existing rows.
--
-- AI-4 AC5 specifies the backfill's staleness query as
-- `embedding IS NULL OR embedding_updated_at < updated_at`, and AI-3's technical note
-- gives `embedding_updated_at` the same purpose. No table in this schema had an
-- `updated_at` column, so that query could not be written at all — this is the enabling
-- change, agreed before AI-4 started.

ALTER TABLE "listings"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

-- Existing rows have never been edited, so their text is as old as the row. Seeding from
-- created_at rather than now() keeps that true, and stops the first backfill from
-- treating every pre-existing listing as freshly changed.
UPDATE "listings" SET "updated_at" = "created_at" WHERE "updated_at" > "created_at";
