/**
 * Vitest global setup for the `integration` project.
 *
 * Runs once per *run*, in the main process, before any worker starts — which is the whole
 * point. Setup files execute per test file, in separate module registries, so a
 * module-level promise there memoises once per file and AC8 ("the container starts once,
 * not once per file") cannot be satisfied.
 *
 * It publishes two values so AC8 is checkable from inside a worker: the connection URL,
 * and the postmaster start time. A file that quietly started its own container would
 * disagree with both.
 */
import { sql } from "drizzle-orm";
import type { TestProject } from "vitest/node";

import { getTestDatabaseUrl, getTestDb, migrateTestDb, stopTestDatabase } from "./db";

export async function setup(project: TestProject) {
  const url = await getTestDatabaseUrl();

  // AI-3's 0005 and 0006 run here too, which is what makes the vector extension and
  // listings.embedding available to every integration test (AC3).
  await migrateTestDb();

  const db = await getTestDb();
  const result = await db.execute(sql`SELECT pg_postmaster_start_time() AS started`);
  const startedAt = new Date(result.rows[0].started as string).toISOString();

  project.provide("testDatabaseUrl", url);
  project.provide("postmasterStartTime", startedAt);

  // Workers read this in src/test/setup/integration.ts. Publishing it as an environment
  // variable is what stops a worker from resolving "no URL" and starting its own
  // container.
  process.env.TEST_DATABASE_URL = url;
}

export async function teardown() {
  // AC9's ordinary path. The crash path is Testcontainers' reaper, which is why the
  // harness never disables it.
  await stopTestDatabase();
}
