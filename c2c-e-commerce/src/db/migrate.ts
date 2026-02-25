import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env when running locally; in production env vars are injected directly.
dotenv.config();

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
      await migrate(db, {
        migrationsFolder: path.resolve(__dirname, "../../drizzle"),
      });
      console.log("Migrations complete.");
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      const isRetryable =
        code === "ENOTFOUND" ||
        code === "ECONNREFUSED" ||
        code === "ETIMEDOUT" ||
        code === "ECONNRESET";

      if (isRetryable && attempt < MAX_RETRIES) {
        console.warn(
          `Database not ready (${code}), retrying in ${RETRY_DELAY_MS / 1000}s...`
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

runMigrations().catch(() => {
  process.exit(1);
});
