/**
 * Test-database harness.
 *
 * Per decision D6, one code path covers both environments: `TEST_DATABASE_URL` when set
 * (CI service container) and a `pgvector/pgvector:pg16` container via Testcontainers
 * otherwise (local). The container starts once per *run*, in `src/test/global-setup.ts` —
 * not once per file, which is AC8.
 */
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool } from "pg";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

import * as schema from "@/db/schema";

/** The Drizzle client the factories and tests share. */
export type TestDatabase = NodePgDatabase<typeof schema>;

/** The image is not negotiable: plain `postgres:16` has no `vector` extension to enable. */
export const TEST_DB_IMAGE = "pgvector/pgvector:pg16";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");

export type TestDatabaseSource =
  | { kind: "external"; url: string }
  | { kind: "container"; image: string };

/**
 * Decides where the test database comes from, without side effects.
 *
 * Separated from the starting of it so AC1 and AC2 are fast unit tests rather than two
 * more integration cases.
 */
export function resolveTestDatabaseSource(
  env: Record<string, string | undefined>,
): TestDatabaseSource {
  // A blank value counts as unset: an unconfigured CI variable expands to "", and failing
  // to connect to "" looks nothing like "the service container is missing".
  const url = env.TEST_DATABASE_URL?.trim();
  return url ? { kind: "external", url } : { kind: "container", image: TEST_DB_IMAGE };
}

let container: StartedPostgreSqlContainer | undefined;
let urlPromise: Promise<string> | undefined;
let pool: Pool | undefined;
let db: TestDatabase | undefined;

/**
 * Connection string for the test database.
 *
 * Inside a test worker this resolves from `TEST_DATABASE_URL`, which the integration setup
 * file has already populated from the value global setup published — so a worker never
 * starts a container of its own. Global setup itself calls this once, with the variable
 * unset, and that call is the single container start per run.
 *
 * Memoised as a promise rather than a value so two concurrent callers share one start
 * instead of racing to create two.
 */
export function getTestDatabaseUrl(): Promise<string> {
  if (!urlPromise) {
    urlPromise = (async () => {
      const source = resolveTestDatabaseSource(process.env);
      if (source.kind === "external") return source.url;

      container = await new PostgreSqlContainer(source.image).start();
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
  const migrationPool = new Pool({ connectionString: await getTestDatabaseUrl() });
  try {
    await migrate(drizzle(migrationPool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await migrationPool.end();
  }
}

/**
 * The shared pool for this process.
 *
 * One pool per run rather than one per file: once QA-5 adds a file per route, a pool each
 * would exhaust Postgres's connection limit.
 */
async function getPool(): Promise<Pool> {
  if (!pool) {
    pool = new Pool({ connectionString: await getTestDatabaseUrl() });
  }
  return pool;
}

/** A dedicated pool against the test database. The caller owns it and must `end()` it. */
export async function testPool(): Promise<Pool> {
  return new Pool({ connectionString: await getTestDatabaseUrl() });
}

/** A Drizzle client bound to the migrated test database. */
export async function getTestDb(): Promise<TestDatabase> {
  if (!db) {
    db = drizzle(await getPool(), { schema });
  }
  return db;
}

/**
 * Empties every table and restarts identity sequences.
 *
 * TRUNCATE rather than a transaction rollback, per the story's technical note: route
 * handlers open their own connections from the pool, so a transaction held open by the
 * test would be invisible to them.
 *
 * Table names come from `pg_tables` rather than a hard-coded list, so a future migration
 * cannot leave a table silently un-truncated and carrying rows into the next test.
 */
export async function resetDb(): Promise<void> {
  const client = await getTestDb();

  const result = await client.execute(sql`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> '__drizzle_migrations'
  `);

  const tables = result.rows.map((row) => row.tablename as string);
  if (tables.length === 0) return;

  const list = sql.join(
    tables.map((table) => sql.identifier(table)),
    sql`, `,
  );

  // CASCADE because listings reference users and order_items reference both; RESTART
  // IDENTITY because a test asserting on a specific id must not depend on suite order.
  await client.execute(sql`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Closes the shared pool and stops the container, if this process started one. */
export async function stopTestDatabase(): Promise<void> {
  await pool?.end().catch(() => {});
  pool = undefined;
  db = undefined;

  if (container) {
    await container.stop();
    container = undefined;
  }
  urlPromise = undefined;
}
