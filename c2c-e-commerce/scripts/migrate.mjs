// Plain-JS migration runner — no tsx/TypeScript needed at runtime.
// Uses only drizzle-orm/node-postgres and pg, which are production dependencies
// already present in the Next.js standalone node_modules.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;

async function runMigrations() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
      console.log(`Running migrations (attempt ${attempt}/${MAX_RETRIES})...`);
      const db = drizzle(pool);
      await migrate(db, { migrationsFolder: resolve(__dirname, "../drizzle") });
      console.log("Migrations complete.");
      return;
    } catch (err) {
      const isRetryable =
        err.code === "ENOTFOUND" ||
        err.code === "ECONNREFUSED" ||
        err.code === "ETIMEDOUT" ||
        err.code === "ECONNRESET";

      if (isRetryable && attempt < MAX_RETRIES) {
        console.warn(
          `Database not ready (${err.code}), retrying in ${RETRY_DELAY_MS / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error("Migration failed:", err);
        throw err;
      }
    } finally {
      await pool.end().catch(() => {});
    }
  }
}

try {
  await runMigrations();
} catch {
  process.exit(1);
}
