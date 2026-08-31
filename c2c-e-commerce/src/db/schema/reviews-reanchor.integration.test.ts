/**
 * Part 4 spec §6.5 — the 0017 backfill, replayed on a database that has never seen it.
 *
 * The shared test database arrives fully migrated, so it cannot show what the migration
 * *did*. This starts its own container, applies 0000-0016, writes the pre-migration data
 * that matters, and then applies 0017 alone.
 *
 * The second of two tests in the suite that start their own container (the other is
 * `orders-collapse.integration.test.ts`). That cost buys the thing a data migration that
 * deletes rows needs and nothing else provides: evidence about which rows it deletes.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_DB_IMAGE } from "@/test/db";
import { apply, migrationFiles } from "@/test/migration-replay";

const REANCHOR = "0017_reviews_reanchor.sql";
const PREVIOUS = "0016_drop_order_items.sql";

let container: StartedPostgreSqlContainer;
let client: Client;

/** Ids the assertions read back, captured while writing the pre-migration fixture. */
const ids = {
  buyer: 0,
  otherBuyer: 0,
  seller: 0,
  listing: 0,
  secondListing: 0,
  cancelledOrder: 0,
  completedOrder: 0,
  otherBuyerOrder: 0,
  duplicateKeeper: 0,
  duplicateLoser: 0,
  orphanReview: 0,
  otherBuyerReview: 0,
};

beforeAll(async () => {
  container = await new PostgreSqlContainer(TEST_DB_IMAGE).start();
  client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();

  // Everything up to and including 0016 — the database as it stood before this part.
  for (const file of migrationFiles()) {
    await apply(client, file);
    if (file === PREVIOUS) break;
  }

  const one = async (sql: string, params: unknown[] = []): Promise<number> => {
    const result = await client.query(sql, params);
    return result.rows[0].id as number;
  };

  ids.seller = await one(
    `INSERT INTO users (email, name, password_hash) VALUES ('seller@t.test', 'Seller', 'x') RETURNING id`,
  );
  ids.buyer = await one(
    `INSERT INTO users (email, name, password_hash) VALUES ('buyer@t.test', 'Buyer', 'x') RETURNING id`,
  );
  ids.otherBuyer = await one(
    `INSERT INTO users (email, name, password_hash) VALUES ('other@t.test', 'Other', 'x') RETURNING id`,
  );

  ids.listing = await one(
    `INSERT INTO listings (title, description, price, seller_id, status)
     VALUES ('Sofa', 'A sofa', '100.00', $1, 'sold') RETURNING id`,
    [ids.seller],
  );
  ids.secondListing = await one(
    `INSERT INTO listings (title, description, price, seller_id, status)
     VALUES ('Lamp', 'A lamp', '20.00', $1, 'sold') RETURNING id`,
    [ids.seller],
  );

  const order = async (
    buyer: number,
    listing: number,
    status: string,
    createdAt: string,
  ): Promise<number> =>
    one(
      `INSERT INTO orders (buyer_id, seller_id, listing_id, price, status, expires_at, created_at)
       VALUES ($1, $2, $3, '100.00', $4, now() + interval '48 hours', $5) RETURNING id`,
      [buyer, ids.seller, listing, status, createdAt],
    );

  // The buyer cancelled first and completed later. The backfill must anchor their review
  // to the completed one, not to the earlier cancelled one.
  ids.cancelledOrder = await order(ids.buyer, ids.listing, "cancelled", "2026-01-01");
  ids.completedOrder = await order(ids.buyer, ids.listing, "completed", "2026-02-01");
  ids.otherBuyerOrder = await order(ids.otherBuyer, ids.secondListing, "completed", "2026-03-01");

  const review = async (
    reviewer: number,
    listing: number,
    rating: number,
    createdAt: string,
  ): Promise<number> =>
    one(
      `INSERT INTO reviews (reviewer_id, listing_id, rating, comment, created_at)
       VALUES ($1, $2, $3, 'ok', $4) RETURNING id`,
      [reviewer, listing, rating, createdAt],
    );

  // Two reviews by one buyer for one listing: the old duplicate check was a SELECT then
  // an INSERT, so two concurrent posts could both land. Only the earliest may survive.
  ids.duplicateKeeper = await review(ids.buyer, ids.listing, 4, "2026-02-02");
  ids.duplicateLoser = await review(ids.buyer, ids.listing, 1, "2026-02-03");

  ids.otherBuyerReview = await review(ids.otherBuyer, ids.secondListing, 5, "2026-03-02");

  // A review with no order behind it at all. Under the old eligibility rule none should
  // exist; seed and hand-edited data may disagree (spec §6.5).
  const orphanListing = await one(
    `INSERT INTO listings (title, description, price, seller_id, status)
     VALUES ('Ghost', 'No orders', '5.00', $1, 'active') RETURNING id`,
    [ids.seller],
  );
  ids.orphanReview = await review(ids.otherBuyer, orphanListing, 2, "2026-03-03");

  await apply(client, REANCHOR);
}, 180_000);

afterAll(async () => {
  await client?.end();
  await container?.stop();
});

describe("0017 — re-anchoring reviews to orders", () => {
  it("anchors a review to the reviewer's completed order, not their earliest one", async () => {
    const { rows } = await client.query(
      `SELECT order_id, seller_id FROM reviews WHERE id = $1`,
      [ids.duplicateKeeper],
    );

    expect(rows[0].order_id).toBe(ids.completedOrder);
    expect(rows[0].seller_id).toBe(ids.seller);
  });

  it("keeps the earliest of two reviews that map to one order and deletes the rest", async () => {
    const { rows } = await client.query(`SELECT id FROM reviews WHERE id = ANY($1)`, [
      [ids.duplicateKeeper, ids.duplicateLoser],
    ]);

    expect(rows.map((r) => r.id)).toEqual([ids.duplicateKeeper]);
  });

  it("deletes a review with no matching order", async () => {
    const { rowCount } = await client.query(`SELECT 1 FROM reviews WHERE id = $1`, [
      ids.orphanReview,
    ]);

    expect(rowCount).toBe(0);
  });

  it("leaves a second reviewer's review on its own order", async () => {
    const { rows } = await client.query(`SELECT order_id FROM reviews WHERE id = $1`, [
      ids.otherBuyerReview,
    ]);

    expect(rows[0].order_id).toBe(ids.otherBuyerOrder);
  });

  it("backfills the seller's aggregates from the surviving reviews", async () => {
    // 4 from the surviving duplicate and 5 from the other buyer; the 1 and the 2 were
    // deleted. A stored mean could not be checked this way — that is D7's point.
    const { rows } = await client.query(
      `SELECT review_count, rating_sum FROM users WHERE id = $1`,
      [ids.seller],
    );

    expect(rows[0].review_count).toBe(2);
    expect(rows[0].rating_sum).toBe(9);
  });

  it("leaves a user with no reviews at zero rather than null", async () => {
    const { rows } = await client.query(
      `SELECT review_count, rating_sum FROM users WHERE id = $1`,
      [ids.buyer],
    );

    expect(rows[0].review_count).toBe(0);
    expect(rows[0].rating_sum).toBe(0);
  });

  it("refuses a second review on an order that already has one", async () => {
    // The whole point of the re-anchor: one review per transaction is structural now, not
    // a SELECT two concurrent posts both pass.
    await expect(
      client.query(
        `INSERT INTO reviews (reviewer_id, seller_id, order_id, rating) VALUES ($1, $2, $3, 5)`,
        [ids.buyer, ids.seller, ids.completedOrder],
      ),
    ).rejects.toThrow(/reviews_one_per_order_idx/);
  });

  it("still has listing_id, now nullable, for 0018 to drop", async () => {
    const { rows } = await client.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'reviews' AND column_name = 'listing_id'`,
    );

    expect(rows[0].is_nullable).toBe("YES");
  });
});
