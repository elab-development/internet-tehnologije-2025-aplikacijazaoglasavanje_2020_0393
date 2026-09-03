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
 * preserves what it claims to preserve — and, at the end of the file, evidence that it
 * refuses to run at all on the one row shape it cannot preserve. That last case gets a
 * second *database* inside the same container, not a second container.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ORDER_STATUSES } from "@/lib/order-lifecycle";
import { TEST_DB_IMAGE } from "@/test/db";
import { apply, migrationFiles } from "@/test/migration-replay";

const COLLAPSE = "0015_orders_collapse.sql";
const RESERVED = "0014_listing_reserved_status.sql";

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
      ('Road bike',  'Fast',   '500.00', 'active', 1, 1),
      ('Track pump', 'Solid',  ' 30.00', 'active', 1, 1),
      ('Helmet',     'Safe',   ' 45.00', 'active', 2, 1),
      ('Pannier',    'Roomy',  ' 60.00', 'active', 2, 1),
      ('Turbo',      'Loud',   '200.00', 'active', 1, 1),
      ('Wheelset',   'Light',  '400.00', 'active', 2, 1)
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
  // ── The old double-sell's residue ───────────────────────────────────────────
  // A listing became `sold` only when its *seller* approved the order; an admin approval
  // left it `active`, so a second buyer could claim the same object. Both shapes below
  // are what that produced, and 0015 has to settle them or the new code inherits two
  // live orders on one listing.

  // Listing 5: approved (an admin's), plus the pending order that shadow claim produced.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at) VALUES
      (5, 3, '200.00', 'approved', now() - interval '3 days'),
      (6, 3, '200.00', 'pending',  now() - interval '2 hours')
  `);
  await client.query(`
    INSERT INTO order_items (order_id, listing_id, price, quantity) VALUES
      (5, 5, '200.00', 1),
      (6, 5, '200.00', 1)
  `);

  // Listing 6: two pending orders, neither decided. The earliest claim is the one the
  // new reservation path would have kept.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at) VALUES
      (7, 3, '400.00', 'pending', now() - interval '3 hours'),
      (8, 3, '400.00', 'pending', now() - interval '1 hour')
  `);
  await client.query(`
    INSERT INTO order_items (order_id, listing_id, price, quantity) VALUES
      (7, 6, '400.00', 1),
      (8, 6, '400.00', 1)
  `);

  await client.query(`SELECT setval('orders_id_seq', 8)`);

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

  it("sells a listing whose order was approved, whoever recorded the approval", async () => {
    // Order 1 arrives here as `confirmed`, and confirmed is not settled: the seller
    // agreed to the sale. The old handler only sold the listing when a *seller* clicked
    // approve, so an admin's approval left this row `active` and buyable — which is the
    // state a new buyer could claim out from under a sale that had already happened.
    const { rows } = await client.query(`SELECT status FROM listings WHERE id = 1`);
    expect(rows[0].status).toBe("sold");
  });

  it("sells both listings of a split order that had been approved", async () => {
    const { rows } = await client.query(
      `SELECT id, status FROM listings WHERE id IN (2, 3) ORDER BY id`,
    );
    expect(rows.map((r) => r.status)).toEqual(["sold", "sold"]);
  });
});

describe("0015 — settling the old double-sell", () => {
  it("expires a pending order left over beside a confirmed one", async () => {
    // Listing 5's sale already happened. The pending order is the residue of the second
    // claim the old bug allowed, and declining it would have un-sold the real sale.
    const { rows } = await client.query(`SELECT status FROM orders WHERE id = 6`);
    expect(rows[0].status).toBe("expired");
  });

  it("sells the listing that pending order was shadowing", async () => {
    const { rows } = await client.query(`SELECT status FROM listings WHERE id = 5`);
    expect(rows[0].status).toBe("sold");
  });

  it("keeps the earliest of two pending orders and expires the rest", async () => {
    const { rows } = await client.query(
      `SELECT id, status FROM orders WHERE id IN (7, 8) ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: 7, status: "pending" },
      { id: 8, status: "expired" },
    ]);
  });

  it("reserves the listing for the pending order it kept", async () => {
    const { rows } = await client.query(`SELECT status FROM listings WHERE id = 6`);
    expect(rows[0].status).toBe("reserved");
  });

  it("leaves at most one live order per listing", async () => {
    const { rows } = await client.query(`
      SELECT listing_id, count(*)::int AS n
        FROM orders
       WHERE status IN ('pending', 'confirmed', 'shipped')
       GROUP BY listing_id
      HAVING count(*) > 1
    `);

    expect(rows).toEqual([]);
  });

  it("makes that invariant structural, not a one-off cleanup", async () => {
    // Without the index the next duplicate arrives by some other route and nothing says
    // so. With it, the database refuses.
    const { rows } = await client.query(`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'orders_one_live_per_listing_idx'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("UNIQUE");

    await expect(
      client.query(`
        INSERT INTO orders (buyer_id, seller_id, listing_id, price, status, expires_at)
        VALUES (3, 2, 6, '400.00', 'pending', now() + interval '48 hours')
      `),
    ).rejects.toThrow(/orders_one_live_per_listing_idx/);
  });
});

describe("0015 — what it deliberately leaves for 0016", () => {
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

/**
 * The one shape 0015 refuses to migrate.
 *
 * Every line becomes an order priced at that line's *unit* price, so `quantity = 3`
 * would silently become an order worth a third of what was owed — and 0016 drops
 * `total_price`, the only column that still held the real figure. The guard aborts
 * instead of losing a number nobody can reconstruct.
 *
 * Its own database inside the same container rather than its own container: the fixture
 * has to be one 0015 has never touched, and starting a second Postgres to get that costs
 * far more than a `CREATE DATABASE`.
 */
describe("0015 — the quantity guard", () => {
  let guarded: Client;

  beforeAll(async () => {
    await client.query(`CREATE DATABASE "quantity_guard"`);

    const uri = new URL(container.getConnectionUri());
    uri.pathname = "/quantity_guard";
    guarded = new Client({ connectionString: uri.toString() });
    await guarded.connect();

    for (const file of migrationFiles()) {
      await apply(guarded, file);
      if (file === RESERVED) break;
    }

    await guarded.query(`
      INSERT INTO users (email, password_hash, name, role) VALUES
        ('seller@example.test', 'x', 'Seller', 'seller'),
        ('buyer@example.test',  'x', 'Buyer',  'buyer')
    `);
    await guarded.query(`
      INSERT INTO categories (name, slug, path, depth) VALUES ('Bikes', 'bikes', '1', 0)
    `);
    await guarded.query(`
      INSERT INTO listings (title, description, price, status, seller_id, category_id)
      VALUES ('Inner tube', 'Spare', '6.00', 'active', 1, 1)
    `);
    await guarded.query(`
      INSERT INTO orders (id, buyer_id, total_price, status, created_at)
      VALUES (1, 2, '12.00', 'pending', now())
    `);
    // The row the collapse cannot represent: two of them, at 6.00 each.
    await guarded.query(`
      INSERT INTO order_items (order_id, listing_id, price, quantity) VALUES (1, 1, '6.00', 2)
    `);
  }, 180_000);

  afterAll(async () => {
    await guarded?.end().catch(() => {});
  });

  it("refuses to run rather than lose the quantity", async () => {
    await expect(apply(guarded, COLLAPSE)).rejects.toThrow(
      /cannot be collapsed losslessly/,
    );
  });

  it("leaves the database as it found it, so the rows can be reconciled by hand", async () => {
    // The file runs in one transaction, so the abort takes the new columns with it and
    // the operator still has `order_items.quantity` to work from.
    const { rows } = await guarded.query(`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'listing_id'
    `);

    expect(rows[0].n).toBe(0);
  });
});
