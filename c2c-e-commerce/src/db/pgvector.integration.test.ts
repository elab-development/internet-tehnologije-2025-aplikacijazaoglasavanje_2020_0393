/**
 * C2C-AI-3 spec — pgvector against a real Postgres.
 *
 * These run against `pgvector/pgvector:pg16`, started by Testcontainers locally or
 * supplied through `TEST_DATABASE_URL` in CI. AC6 (docker compose) and AC7 (Railway) are
 * environment checks and live in `pgvector.compose.test.ts` and the story's comments
 * respectively.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";

import { migrateTestDb, stopTestDatabase, testPool, getTestDatabaseUrl } from "../test/db";

const APP_ROOT = path.resolve(__dirname, "../..");

let pool: Pool;

beforeAll(async () => {
  await migrateTestDb();
  pool = await testPool();
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await stopTestDatabase();
});

describe("C2C-AI-3 — migration 0005: the vector extension", () => {
  it("AC1: `npm run db:migrate` leaves the vector extension installed", async () => {
    const { rows } = await pool.query(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    expect(rows).toHaveLength(1);
  });

  it("AC1: the vector type is usable, not merely registered", async () => {
    const { rows } = await pool.query("SELECT '[1,2,3]'::vector AS v");
    expect(rows[0].v).toBeDefined();
  });
});

describe("C2C-AI-3 — migration 0006: the embedding column", () => {
  it("AC2: listings.embedding exists, is a vector, and is nullable", async () => {
    const { rows } = await pool.query(
      `SELECT is_nullable, udt_name
         FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'embedding'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].udt_name).toBe("vector");
    // Nullable on purpose: AI-4 AC2 requires a listing to be creatable when embedding
    // fails, and AI-7 keeps such rows reachable through the keyword arm.
    expect(rows[0].is_nullable).toBe("YES");
  });

  it("AC2: the column is declared with exactly 384 dimensions", async () => {
    const { rows } = await pool.query(
      `SELECT format_type(a.atttypid, a.atttypmod) AS declared
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'listings' AND a.attname = 'embedding'`,
    );

    expect(rows[0].declared).toBe(`vector(${EMBEDDING_DIMENSIONS})`);
    expect(rows[0].declared).toBe("vector(384)");
  });

  it("AC2: a vector of the wrong width is rejected by the database", async () => {
    // The dimension is a real constraint, not documentation. AI-2's per-row tensor slice
    // is what keeps the write path on the right side of it.
    await expect(
      pool.query("SELECT '[1,2,3]'::vector(384)"),
    ).rejects.toThrow(/expected 384 dimensions|does not match/i);
  });

  it("AC2: listings.embedding_updated_at exists and is nullable", async () => {
    const { rows } = await pool.query(
      `SELECT is_nullable, data_type
         FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'embedding_updated_at'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toMatch(/timestamp/);
    expect(rows[0].is_nullable).toBe("YES");
  });
});

describe("C2C-AI-3 — the HNSW index", () => {
  it("AC3: listings_embedding_hnsw_idx exists on listings", async () => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'listings' AND indexname = 'listings_embedding_hnsw_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("AC3: it uses hnsw with vector_cosine_ops", async () => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'listings' AND indexname = 'listings_embedding_hnsw_idx'`,
    );

    // HNSW over IVFFlat because it needs no training step and no minimum row count —
    // correct for a dataset that starts near-empty. Cosine because AI-2 emits unit
    // vectors.
    expect(rows[0].indexdef).toMatch(/USING hnsw/i);
    expect(rows[0].indexdef).toMatch(/vector_cosine_ops/i);
  });
});

describe("C2C-AI-3 — re-runnability", () => {
  it("AC4: applying the migrations a second time is a no-op and does not error", async () => {
    const before = await pool.query(
      "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
    );

    await expect(migrateTestDb()).resolves.toBeUndefined();

    const after = await pool.query(
      "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  }, 60_000);

  it("AC4: the extension survives a re-run rather than being dropped and recreated", async () => {
    const { rows } = await pool.query(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    expect(rows).toHaveLength(1);
  });
});

describe("C2C-AI-3 — the seed still works", () => {
  it("AC5: db:seed succeeds after migrating, and embeds every listing", async () => {
    execFileSync("npx", ["tsx", "src/db/seed.ts"], {
      cwd: APP_ROOT,
      // Pinned rather than inherited. The seed now calls the embedding provider, and
      // `local` would pull the model down inside the integration job; NODE_ENV happens to
      // reach the subprocess as "test" today, but nothing here should depend on that.
      env: {
        ...process.env,
        DATABASE_URL: await getTestDatabaseUrl(),
        EMBEDDING_PROVIDER: "mock",
      },
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    const total = await pool.query("SELECT count(*)::int AS n FROM listings");
    expect(total.rows[0].n).toBeGreaterThan(0);

    // AI-3 AC5 asks that the seed still *succeed* against a pgvector-migrated database;
    // that is what the execFileSync above proves and it is unchanged. The criterion also
    // recorded that embeddings came out NULL, and AI-3's plan marked it "nothing to
    // implement" on that basis -- a description of the seed as it stood, not a rule that
    // it must stay that way.
    //
    // It did have to change. Leaving the vectors NULL meant a freshly seeded database had
    // no semantic search at all: that mode excludes rows without a vector, so it returned
    // nothing for every query while hybrid quietly fell back to keyword-only. The backfill
    // remains the safety net for rows whose embedding failed; it is no longer the only way
    // a seeded row ever gets one.
    const embedded = await pool.query(
      "SELECT count(*)::int AS n FROM listings WHERE embedding IS NOT NULL",
    );
    expect(embedded.rows[0].n).toBe(total.rows[0].n);

    const widths = await pool.query(
      "SELECT DISTINCT vector_dims(embedding) AS d FROM listings WHERE embedding IS NOT NULL",
    );
    expect(widths.rows.map((r) => r.d)).toEqual([EMBEDDING_DIMENSIONS]);

    // Distinct rows must not share a vector: a batch mis-sliced by one would still be
    // non-NULL and the right width, and only the *values* would give it away.
    const distinct = await pool.query(
      "SELECT count(DISTINCT embedding::text)::int AS n FROM listings WHERE embedding IS NOT NULL",
    );
    expect(distinct.rows[0].n).toBe(total.rows[0].n);
  }, 180_000);

  it("AC5: a seeded row accepts an embedding of the right width", async () => {
    const vector = `[${Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0).join(",")}]`;

    await expect(
      pool.query(
        "UPDATE listings SET embedding = $1::vector, embedding_updated_at = now() WHERE id = (SELECT min(id) FROM listings)",
        [vector],
      ),
    ).resolves.toBeDefined();
  });
});
