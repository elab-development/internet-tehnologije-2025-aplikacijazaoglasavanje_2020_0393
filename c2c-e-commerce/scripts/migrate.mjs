// Plain-JS migration runner — no tsx/TypeScript needed at runtime.
// Uses only drizzle-orm/node-postgres and pg, which are production dependencies
// already present in the Next.js standalone node_modules.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

console.log("Running migrations...");
try {
  await migrate(db, { migrationsFolder: resolve(__dirname, "../drizzle") });
  console.log("Migrations complete.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
