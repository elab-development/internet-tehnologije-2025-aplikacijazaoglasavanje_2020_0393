/**
 * C2C-AI-3 AC7 / risk R1 — can this database run pgvector?
 *
 * Answers the one question AI-3 cannot answer locally: whether the *deployed* Postgres
 * will accept `CREATE EXTENSION vector`. Run it against Railway before trusting the
 * migration job:
 *
 *   DATABASE_URL="<railway url>" node scripts/check-pgvector.mjs
 *
 * Read-only apart from the extension itself, which is created with IF NOT EXISTS and left
 * in place — migration 0005 would do exactly the same thing.
 *
 * Exit 0 means the thesis core is deployable as designed. Exit 1 means R1 has
 * materialised, and the fallback is a self-hosted pgvector/pgvector:pg16 container on
 * Railway. Either way the outcome belongs in the story's comments and the thesis
 * deployment chapter.
 */
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// Managed Postgres almost always requires TLS, and Railway's certificate is not in Node's
// trust store. Verification is disabled for this probe only — it reads no secrets and
// writes nothing beyond the extension.
const pool = new Pool({
  connectionString: url,
  ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

const check = async (label, fn) => {
  try {
    const value = await fn();
    console.log(`  OK    ${label}${value ? `: ${value}` : ""}`);
    return true;
  } catch (error) {
    console.log(`  FAIL  ${label}: ${error.message}`);
    return false;
  }
};

try {
  const server = await pool.query("SHOW server_version");
  console.log(`Postgres ${server.rows[0].server_version}\n`);

  const available = await pool.query(
    "SELECT default_version FROM pg_available_extensions WHERE name = 'vector'",
  );
  if (available.rowCount === 0) {
    console.error(
      "  FAIL  pgvector is not available on this server at all.\n\n" +
        "R1 has materialised. The extension is not merely uninstalled — it is not\n" +
        "offered, so no privilege level can enable it. Fall back to a self-hosted\n" +
        "pgvector/pgvector:pg16 container.",
    );
    process.exit(1);
  }
  console.log(`  OK    pgvector available, version ${available.rows[0].default_version}`);

  const created = await check("CREATE EXTENSION IF NOT EXISTS vector", async () => {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    const { rows } = await pool.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    return `installed, version ${rows[0].extversion}`;
  });

  if (!created) {
    console.error(
      "\nR1 has materialised: pgvector exists but this role may not install it.\n" +
        "Ask the provider to enable it, or fall back to a self-hosted container.",
    );
    process.exit(1);
  }

  const typeWorks = await check("vector type is usable", async () => {
    const { rows } = await pool.query("SELECT '[1,2,3]'::vector <=> '[1,2,4]'::vector AS d");
    return `cosine distance works (${Number(rows[0].d).toFixed(4)})`;
  });

  const hnswWorks = await check("hnsw index method with vector_cosine_ops", async () => {
    await pool.query("CREATE TEMP TABLE _pgvector_probe (v vector(384))");
    await pool.query(
      "CREATE INDEX _pgvector_probe_idx ON _pgvector_probe USING hnsw (v vector_cosine_ops)",
    );
    return "index created";
  });

  if (typeWorks && hnswWorks) {
    console.log("\nAC7 satisfied: migrations 0005 and 0006 will apply to this database.");
    process.exit(0);
  }
  process.exit(1);
} catch (error) {
  console.error(`\nCould not complete the check: ${error.message}`);
  process.exit(1);
} finally {
  await pool.end().catch(() => {});
}
