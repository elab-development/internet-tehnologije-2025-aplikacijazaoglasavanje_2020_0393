/**
 * Minimal test-database harness.
 *
 * Introduced by C2C-AI-3, which needs a real Postgres *with pgvector* to verify its
 * migrations at all. Per decision D6 it uses `TEST_DATABASE_URL` when set (CI service
 * container) and otherwise starts a `pgvector/pgvector:pg16` container via Testcontainers
 * (local), so one code path covers both.
 *
 * C2C-QA-3 owns the full version of this file and will add `resetDb()`, the factories, the
 * auth helper and the semantic fixture catalogue. Two things it must change:
 *
 *   - the container is memoised per *module registry*, which means per test file. AI-3 has
 *     a single integration file so it starts once, but QA-3 AC8 requires once per run —
 *     that needs a Vitest `globalSetup`, not a module-level promise.
 *   - teardown here is registered per file; QA-3 AC9 wants it global.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool } from "pg";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

/** The image is not negotiable: plain `postgres:16` has no `vector` extension to enable. */
export const TEST_DB_IMAGE = "pgvector/pgvector:pg16";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");

let container: StartedPostgreSqlContainer | undefined;
let urlPromise: Promise<string> | undefined;

/**
 * Connection string for a migrated test database.
 *
 * Memoised as a promise rather than a value so two concurrent callers share one container
 * start rather than racing to create two.
 */
export function getTestDatabaseUrl(): Promise<string> {
  if (!urlPromise) {
    urlPromise = (async () => {
      const provided = process.env.TEST_DATABASE_URL?.trim();
      if (provided) return provided;

      container = await new PostgreSqlContainer(TEST_DB_IMAGE).start();
      return container.getConnectionUri();
    })();

    urlPromise.catch(() => {
      urlPromise = undefined;
    });
  }
  return urlPromise;
}

/** Applies every migration in `drizzle/` to the test database. */
export async function migrateTestDb(): Promise<void> {
  const pool = new Pool({ connectionString: await getTestDatabaseUrl() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

/** A pool against the test database. The caller owns it and must `end()` it. */
export async function testPool(): Promise<Pool> {
  return new Pool({ connectionString: await getTestDatabaseUrl() });
}

/** Stops the container, if this process started one. */
export async function stopTestDatabase(): Promise<void> {
  if (container) {
    await container.stop();
    container = undefined;
  }
  urlPromise = undefined;
}
