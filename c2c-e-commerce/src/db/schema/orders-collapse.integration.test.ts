/**
 * Part 3 spec §8 — the 0015 backfill, replayed on a database that has never seen it.
 *
 * The shared test database arrives fully migrated, so it cannot show what the migration
 * *did*. This starts its own container, applies 0000-0014, writes the pre-migration data
 * that matters — including a multi-item order the current UI cannot produce — and then
 * applies 0015 alone.
 *
 * It is the only test in the suite that starts a second container. That cost buys the
 * one thing an irreversible data migration needs and nothing else provides: evidence it
 * preserves what it claims to preserve.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ORDER_STATUSES } from "@/lib/order-lifecycle";
import { TEST_DB_IMAGE } from "@/test/db";

const MIGRATIONS = path.resolve(__dirname, "../../../drizzle");

const COLLAPSE = "0015_orders_collapse.sql";
const RESERVED = "0014_listing_reserved_status.sql";

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Applies one migration file the way Drizzle's migrator does: split on the breakpoint
 * marker, run every statement inside a single transaction.
 */
async function apply(client: Client, file: string): Promise<void> {
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

let container: StartedPostgreSqlContainer;
let client: Client;

beforeAll(async () => {
  container = await new PostgreSqlContainer(TEST_DB_IMAGE).start();
  client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();

  // Everything up to and including 0014 — the database as it stood before this part.
  for (const file of migrationFiles()) {
    await apply(client, file);
    if (file === RESERVED) break;
  }

  // ── Pre-migration data ──────────────────────────────────────────────────────
  await client.query(`
    INSERT INTO users (email, password_hash, name, role) VALUES
      ('seller-a@example.test', 'x', 'Seller A', 'seller'),
      ('seller-b@example.test', 'x', 'Seller B', 'seller'),
      ('buyer@example.test',    'x', 'Buyer',    'buyer')
  `);
  await client.query(`
    INSERT INTO categories (name, slug, path, depth) VALUES ('Bikes', 'bikes', '1', 0)
  `);
  await client.query(`
    INSERT INTO listings (title, description, price, status, seller_id, category_id) VALUES
      ('Road bike',  'Fast',  '500.00', 'active', 1, 1),
      ('Track pump', 'Solid', ' 30.00', 'active', 1, 1),
      ('Helmet',     'Safe',  ' 45.00', 'active', 2, 1),
      ('Pannier',    'Roomy', ' 60.00', 'active', 2, 1)
  `);

  // A single-line order in the old `approved` state.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at)
    VALUES (1, 3, '500.00', 'approved', now() - interval '10 days')
  `);
  await client.query(`
    INSERT INTO order_items (order_id, listing_id, price, quantity) VALUES (1, 1, '500.00', 1)
  `);

  // A two-line order: the shape production data may hold and the UI cannot produce.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at)
    VALUES (2, 3, '75.00', 'paid', now() - interval '5 days')
  `);
  await client.query(`
    INSERT INTO order_items (order_id, listing_id, price, quantity) VALUES
      (2, 2, '30.00', 1),
      (2, 3, '45.00', 1)
  `);

  // A live pending order, whose listing must come out of this `reserved`.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at)
    VALUES (3, 3, '60.00', 'pending', now())
  `);
  await client.query(`
    INSERT INTO order_items (order_id, listing_id, price, quantity) VALUES (3, 4, '60.00', 1)
  `);

  // An order with no lines at all. Nothing about it is recoverable.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at)
    VALUES (4, 3, '0.00', 'cancelled', now() - interval '90 days')
  `);
  await client.query(`SELECT setval('orders_id_seq', 4)`);

  await apply(client, COLLAPSE);
}, 180_000);

afterAll(async () => {
  await client?.end().catch(() => {});
  await container?.stop();
});

describe("0015 — the status enum", () => {
  it("holds exactly the seven statuses the graph names", async () => {
    const { rows } = await client.query<{ label: string }>(`
      SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'order_status'
    `);

    expect(rows.map((r) => r.label).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it("keeps reserved on listing_status, added by 0014", async () => {
    const { rows } = await client.query<{ label: string }>(`
      SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'listing_status'
    `);

    expect(rows.map((r) => r.label)).toContain("reserved");
  });
});

describe("0015 — the status mapping", () => {
  it("maps approved to confirmed", async () => {
    const { rows } = await client.query(`SELECT status FROM orders WHERE id = 1`);
    expect(rows[0].status).toBe("confirmed");
  });

  it("maps paid to confirmed, because paid was never a state any flow reached", async () => {
    const { rows } = await client.query(`SELECT status FROM orders WHERE id = 2`);
    expect(rows[0].status).toBe("confirmed");
  });
});

describe("0015 — the multi-item split", () => {
  it("turns a two-line order into two orders", async () => {
    const { rows } = await client.query(`
      SELECT listing_id, price::text, seller_id, status, created_at
        FROM orders
       WHERE listing_id IN (2, 3)
       ORDER BY listing_id
    `);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ listing_id: 2, price: "30.00", seller_id: 1 });
    expect(rows[1]).toMatchObject({ listing_id: 3, price: "45.00", seller_id: 2 });
  });

  it("gives every split order the original's status and creation date", async () => {
    const { rows } = await client.query(`
      SELECT DISTINCT status, date_trunc('second', created_at) AS at
        FROM orders WHERE listing_id IN (2, 3)
    `);

    // One distinct pair: both halves inherited the same two facts.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("confirmed");
  });

  it("prices each order from its own line, not the order total", async () => {
    const { rows } = await client.query(`
      SELECT sum(price)::text AS total FROM orders WHERE listing_id IN (2, 3)
    `);

    expect(rows[0].total).toBe("75.00");
  });
});

describe("0015 — the columns", () => {
  it("captures the seller from the listing", async () => {
    const { rows } = await client.query(`SELECT seller_id FROM orders WHERE listing_id = 1`);
    expect(rows[0].seller_id).toBe(1);
  });

  it("gives every order a deadline 48 hours after it was placed", async () => {
    const { rows } = await client.query(`
      SELECT extract(epoch FROM (expires_at - created_at)) AS seconds
        FROM orders WHERE listing_id = 1
    `);

    expect(Number(rows[0].seconds)).toBe(48 * 60 * 60);
  });

  it("leaves no order without a listing", async () => {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM orders WHERE listing_id IS NULL`);
    expect(rows[0].n).toBe(0);
  });

  it("deletes the order that had no lines at all", async () => {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM orders WHERE id = 4`);
    expect(rows[0].n).toBe(0);
  });
});

describe("0015 — the listing backfill", () => {
  it("reserves a listing held by a live pending order", async () => {
    const { rows } = await client.query(`SELECT status FROM listings WHERE id = 4`);
    expect(rows[0].status).toBe("reserved");
  });

  it("leaves a listing whose orders are all settled alone", async () => {
    const { rows } = await client.query(`SELECT status FROM listings WHERE id = 1`);
    expect(rows[0].status).toBe("active");
  });
});

describe("0015 — what it deliberately does not do", () => {
  it("keeps order_items, so consumers can be migrated one at a time", async () => {
    const { rows } = await client.query(`
      SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'order_items'
    `);
    expect(rows[0].n).toBe(1);
  });

  it("keeps total_price, but stops requiring it", async () => {
    const { rows } = await client.query(`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'total_price'
    `);
    expect(rows[0].is_nullable).toBe("YES");
  });
});
