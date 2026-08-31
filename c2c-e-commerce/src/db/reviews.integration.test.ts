/**
 * Part 4 spec §6.1 and D7 — the two statements a review write is made of.
 *
 * Tested on their own here, so a failure in a route's transaction points at the route
 * rather than at the SQL underneath it.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyRatingDelta,
  isDuplicateReviewViolation,
  ONE_REVIEW_PER_ORDER_INDEX,
} from "@/db/reviews";
import * as schema from "@/db/schema";
import { reviews, users } from "@/db/schema";
import { deleteDelta, insertDelta, updateDelta } from "@/lib/reviews";
import { getTestDb, resetDb, testPool } from "@/test/db";
import { makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function aggregatesOf(userId: number) {
  const db = await getTestDb();
  const [row] = await db
    .select({ reviewCount: users.reviewCount, ratingSum: users.ratingSum })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

describe("applyRatingDelta", () => {
  it("moves both integers by the delta", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });

    const moved = await applyRatingDelta(db, seller.id, insertDelta(4));

    expect(moved).toBe(1);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 4 });
  });

  it("applies an edit without touching the count", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });

    await applyRatingDelta(db, seller.id, insertDelta(2));
    await applyRatingDelta(db, seller.id, updateDelta(2, 5));

    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 5 });
  });

  it("returns a seller to zero after a delete", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });

    await applyRatingDelta(db, seller.id, insertDelta(3));
    await applyRatingDelta(db, seller.id, deleteDelta(3));

    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 0, ratingSum: 0 });
  });

  it("reports 0 for a seller who does not exist", async () => {
    const db = await getTestDb();
    expect(await applyRatingDelta(db, 999_999, insertDelta(5))).toBe(0);
  });

  it("composes two overlapping writers instead of letting one overwrite the other", async () => {
    // The reason this is `x = x + n` rather than a recomputed COUNT/SUM. Two transactions
    // held open at once: the second's UPDATE blocks on the first's row lock, then applies
    // its delta to the committed row. A recompute would have both read the pre-insert
    // state and one of the two reviews would vanish from the total.
    const seller = await makeUser({ role: "seller" });

    // A dedicated pool, because the shared one is what `resetDb` and the factories use —
    // holding two of its connections open across a lock wait would starve them.
    const pool = await testPool();
    const a = await pool.connect();
    const b = await pool.connect();

    try {
      const dbA = drizzle(a, { schema });
      const dbB = drizzle(b, { schema });

      await a.query("BEGIN");
      await b.query("BEGIN");

      await applyRatingDelta(dbA, seller.id, insertDelta(5));

      // Deliberately not awaited yet: B's UPDATE has to reach the server and block on A's
      // row lock while A is still open, which is the interleaving under test.
      const bWrite = applyRatingDelta(dbB, seller.id, insertDelta(3));
      await new Promise((resolve) => setTimeout(resolve, 250));

      await a.query("COMMIT");
      await bWrite;
      await b.query("COMMIT");
    } finally {
      a.release();
      b.release();
      await pool.end();
    }

    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 2, ratingSum: 8 });
  });
});

describe("the one-review-per-order index", () => {
  it("refuses a second review on the same order", async () => {
    const db = await getTestDb();
    const order = await makeOrder({ status: "completed" });

    const row = {
      reviewerId: order.buyerId,
      sellerId: order.sellerId,
      orderId: order.id,
      rating: 5,
    };

    await db.insert(reviews).values(row);

    await expect(db.insert(reviews).values(row)).rejects.toThrow();
  });

  it("recognises that refusal, through Drizzle's wrapper", async () => {
    // The check the route's 409 depends on. Drizzle wraps the driver's error, so this is
    // the assertion that would fail if the branch were reading `code` off the wrapper.
    const db = await getTestDb();
    const order = await makeOrder({ status: "completed" });

    const row = {
      reviewerId: order.buyerId,
      sellerId: order.sellerId,
      orderId: order.id,
      rating: 5,
    };

    await db.insert(reviews).values(row);

    let caught: unknown;
    try {
      await db.insert(reviews).values(row);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isDuplicateReviewViolation(caught)).toBe(true);
  });

  it("names the index the migration actually created", async () => {
    const db = await getTestDb();
    const result = await db.execute(
      `SELECT indexname FROM pg_indexes WHERE indexname = '${ONE_REVIEW_PER_ORDER_INDEX}'`,
    );

    expect(result.rows).toHaveLength(1);
  });

  it("allows two reviews of the same seller on different orders", async () => {
    // The re-anchor's whole purpose: reputation accumulates. A constraint that scoped to
    // the seller instead of the order would defeat it.
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });
    const first = await makeOrder({ status: "completed", sellerId: seller.id });
    const second = await makeOrder({ status: "completed", sellerId: seller.id });

    await db.insert(reviews).values([
      { reviewerId: first.buyerId, sellerId: seller.id, orderId: first.id, rating: 5 },
      { reviewerId: second.buyerId, sellerId: seller.id, orderId: second.id, rating: 3 },
    ]);

    expect(await db.select().from(reviews).where(eq(reviews.sellerId, seller.id))).toHaveLength(2);
  });
});
