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
      // Drizzle wraps pg errors in DrizzleQueryError — the network code lives on .cause
      const cause = (err as { cause?: NodeJS.ErrnoException }).cause;
      const code =
        (err as NodeJS.ErrnoException).code ?? cause?.code;

      const isRetryable =
        code === "ENOTFOUND" ||
        code === "ECONNREFUSED" ||
        code === "ETIMEDOUT" ||
        code === "ECONNRESET";

      if (code === "ENOTFOUND") {
        type WithHostname = { hostname?: string };
        const hostname =
          (cause as WithHostname | undefined)?.hostname ??
          (err as WithHostname).hostname;
        if (hostname === "db") {
          console.error(
            `\nERROR: DATABASE_URL resolves to hostname "db", which is the Docker Compose internal hostname.\n` +
            `On Railway, set DATABASE_URL to the Railway Postgres plugin URL (check your service's Variables tab).\n`
          );
        }
      }

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
