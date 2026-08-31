/**
 * Shared by the tests that replay migrations against a database of their own, rather than
 * the shared fully-migrated one: `orders-collapse.integration.test.ts` (0015) and
 * `reviews-reanchor.integration.test.ts` (0017). Both need to apply a prefix of
 * `drizzle/*.sql` to a fresh container and then run one migration alone, which the shared
 * test database — already migrated to head — cannot show.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Client } from "pg";

export const MIGRATIONS = path.resolve(__dirname, "../../drizzle");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Applies one migration file: split on the breakpoint marker, run every statement inside
 * a single transaction.
 *
 * NOT what Drizzle's migrator does, and the difference matters. The real migrator wraps
 * *all* pending migrations in one transaction; this gives each file its own. That is
 * precisely why this test passed while the real migrator hit Postgres 55P04 ("new enum
 * values must be committed before they can be used") during Task 2 — 0014 added the enum
 * value and 0015 wrote it, which is legal across two transactions and illegal inside
 * one. Nothing here certifies cross-file transaction behaviour; only a real
 * `drizzle-kit`/migrator run does.
 */
export async function apply(client: Client, file: string): Promise<void> {
  const contents = readFileSync(path.join(MIGRATIONS, file), "utf8");
  const statements = contents
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)+$/.test(s));

  await client.query("BEGIN");
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`${file} failed: ${(err as Error).message}`);
  }
}
