-- C2C-AI-3 — the listing embedding column and its index.
--
-- Hand-written: drizzle-kit cannot express an HNSW index with an operator class.
--
-- 384 is repeated as a literal rather than read from EMBEDDING_DIMENSIONS because a
-- migration is a historical record of what was applied. If the model ever changes width,
-- a NEW migration says so; this one must keep meaning what it meant when it ran.

-- Nullable, and with no default, on purpose. A listing must remain creatable when the
-- embedding step fails (AI-4 AC2), and AI-7 uses `embedding IS NOT NULL` to keep such
-- rows out of the vector arm while leaving them reachable by keyword. A DEFAULT would
-- give every pre-existing row a meaningless vector and break both.
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "embedding" vector(384);

-- When the vector was last computed, so a backfill can find rows whose text has since
-- changed.
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "embedding_updated_at" timestamp;

-- HNSW rather than IVFFlat: it needs no training step and no minimum row count, which is
-- correct for a table that starts empty. Building it now costs nothing and means AI-7
-- never has to think about index creation.
--
-- vector_cosine_ops because AI-2 emits unit vectors, so cosine distance and inner product
-- coincide.
CREATE INDEX IF NOT EXISTS "listings_embedding_hnsw_idx"
  ON "listings" USING hnsw ("embedding" vector_cosine_ops);
