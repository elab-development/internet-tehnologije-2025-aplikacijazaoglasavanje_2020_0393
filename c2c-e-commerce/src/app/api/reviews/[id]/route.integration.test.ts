/**
 * Part 4 spec §6.3 — editing and deleting a review keeps the seller's aggregates true.
 *
 * The aggregates are denormalised (D7), which buys a rating on every listing card for the
 * price of one rule: every write to `reviews` moves them in the same transaction. This
 * file is that rule's proof for the two verbs that are not `POST`.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { reviews, users } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeOrder, makeReview, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function patch(
  id: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { PATCH } = await import("./route");
  const response = await PATCH(
    new NextRequest(`http://localhost/api/reviews/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: await response.json() };
}

async function remove(
  id: number,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { DELETE } = await import("./route");
  const response = await DELETE(
    new NextRequest(`http://localhost/api/reviews/${id}`, { method: "DELETE", headers }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: await response.json() };
}

async function aggregatesOf(userId: number) {
  const db = await getTestDb();
  const [row] = await db
    .select({ reviewCount: users.reviewCount, ratingSum: users.ratingSum })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

/** A seller with one three-star review from a buyer who is the review's author. */
async function reviewed() {
  const seller = await makeUser({ role: "seller" });
  const buyer = await makeUser({ role: "buyer" });
  const order = await makeOrder({ buyerId: buyer.id, sellerId: seller.id, status: "completed" });
  const review = await makeReview({ orderId: order.id, reviewerId: buyer.id, rating: 3 });
  return { seller, buyer, review };
}

describe("PATCH /api/reviews/[id]", () => {
  it("lets the author change the rating and moves the sum with it", async () => {
    const { seller, buyer, review } = await reviewed();

    const { status, body } = await patch(review.id, { rating: 5 }, authHeaderFor(buyer));

    expect(status).toBe(200);
    expect(body.rating).toBe(5);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 5 });
  });

  it("leaves the count alone — an edit is the same review", async () => {
    const { seller, buyer, review } = await reviewed();

    await patch(review.id, { rating: 1 }, authHeaderFor(buyer));

    // The whole aggregate, not just the count: `updateDelta`'s countDelta is always 0 by
    // definition, so a count-only assertion here passes even if the sum moved by the
    // wrong amount -- a `from`/`to` swap or a sign error inside `updateDelta` would slip
    // past it. 3 -> 1 must land on sum 1.
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 1 });
  });

  it("lets the author change only the comment, touching no aggregate", async () => {
    const { seller, buyer, review } = await reviewed();

    const { status, body } = await patch(
      review.id,
      { comment: "Second thoughts." },
      authHeaderFor(buyer),
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ comment: "Second thoughts.", rating: 3 });
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 3 });
  });

  it("lets an admin edit, for moderation", async () => {
    const { review } = await reviewed();
    const admin = await makeUser({ role: "admin" });

    expect((await patch(review.id, { rating: 4 }, authHeaderFor(admin))).status).toBe(200);
  });

  it("refuses the seller being reviewed with 403", async () => {
    // The one edit that would make the ratings worthless.
    const { seller, review } = await reviewed();

    const { status } = await patch(review.id, { rating: 5 }, authHeaderFor(seller));

    expect(status).toBe(403);
  });

  it("refuses an unrelated user with 403", async () => {
    const { review } = await reviewed();
    const stranger = await makeUser({ role: "buyer" });

    expect((await patch(review.id, { rating: 5 }, authHeaderFor(stranger))).status).toBe(403);
  });

  it("rejects an anonymous caller with 401", async () => {
    const { review } = await reviewed();
    expect((await patch(review.id, { rating: 5 })).status).toBe(401);
  });

  it("answers 404 for a review that does not exist", async () => {
    const author = await makeUser({ role: "buyer" });
    expect((await patch(999_999, { rating: 5 }, authHeaderFor(author))).status).toBe(404);
  });

  it("answers 400 for an empty body", async () => {
    const { buyer, review } = await reviewed();
    expect((await patch(review.id, {}, authHeaderFor(buyer))).status).toBe(400);
  });

  it("answers 400 for a rating outside 1-5, leaving the aggregates alone", async () => {
    // Without the schema this reaches the CHECK constraint and becomes a 500 — with the
    // seller's totals already moved, because the delta would have been applied first.
    const { seller, buyer, review } = await reviewed();

    const { status } = await patch(review.id, { rating: 0 }, authHeaderFor(buyer));

    expect(status).toBe(400);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 3 });
  });

  it("computes each edit's delta from what actually committed, not a stale pre-transaction read", async () => {
    // Two overlapping edits of the same review. Each request reads the review once,
    // outside any transaction, to decide 404/403 -- that read is what the handler used
    // to compute its delta from too, before this fix. Fire both concurrently: if the
    // delta is still computed from that outer, pre-transaction read, both requests
    // capture rating 3, apply their deltas against that stale value (+2 and -2), and the
    // sum ends up unmoved (3) while the stored rating ends up wherever the later UPDATE
    // left it (1 or 5) -- a seller with one review whose ratingSum no longer equals that
    // review's rating, and nothing afterwards can tell which write went missing.
    //
    // With the fix, the losing request blocks on the winner's `FOR UPDATE` lock and then
    // re-reads the row it just waited on, so its delta is computed against what the
    // winner actually committed -- not the value both requests started from. For a
    // seller with exactly one review, ratingSum must equal that review's rating no
    // matter which edit lands last.
    const { seller, buyer, review } = await reviewed();

    await Promise.all([
      patch(review.id, { rating: 5 }, authHeaderFor(buyer)),
      patch(review.id, { rating: 1 }, authHeaderFor(buyer)),
    ]);

    const db = await getTestDb();
    const [finalReview] = await db.select().from(reviews).where(eq(reviews.id, review.id));

    expect(await aggregatesOf(seller.id)).toEqual({
      reviewCount: 1,
      ratingSum: finalReview.rating,
    });
  });
});

describe("DELETE /api/reviews/[id]", () => {
  it("removes the review and takes its rating out of the aggregates", async () => {
    const db = await getTestDb();
    const { seller, buyer, review } = await reviewed();

    const { status } = await remove(review.id, authHeaderFor(buyer));

    expect(status).toBe(200);
    expect(await db.select().from(reviews).where(eq(reviews.id, review.id))).toHaveLength(0);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 0, ratingSum: 0 });
  });

  it("leaves a seller's other reviews in the total", async () => {
    const seller = await makeUser({ role: "seller" });
    const keeper = await makeUser({ role: "buyer" });
    const regretter = await makeUser({ role: "buyer" });

    const first = await makeOrder({
      sellerId: seller.id,
      buyerId: keeper.id,
      status: "completed",
    });
    const second = await makeOrder({
      sellerId: seller.id,
      buyerId: regretter.id,
      status: "completed",
    });

    await makeReview({ orderId: first.id, reviewerId: keeper.id, rating: 5 });
    const doomed = await makeReview({ orderId: second.id, reviewerId: regretter.id, rating: 2 });

    await remove(doomed.id, authHeaderFor(regretter));

    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 5 });
  });

  it("refuses a non-author with 403 and changes nothing", async () => {
    const { seller, review } = await reviewed();
    const stranger = await makeUser({ role: "buyer" });

    const { status } = await remove(review.id, authHeaderFor(stranger));

    expect(status).toBe(403);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 3 });
  });

  it("never lets a losing concurrent DELETE decrement totals it didn't remove", async () => {
    // Two DELETEs of the same review. Both used to read the outer, unlocked
    // `review.rating` and both applied `deleteDelta` -- the loser matched no row (the
    // winner had already removed it) but still decremented `review_count`/`rating_sum`,
    // driving the seller negative. Whichever DELETE actually removes the row is not
    // deterministic from here, and the fix does not need it to be: Postgres serialises
    // the two `DELETE`s on the same row regardless of scheduling, so exactly one of them
    // gets a row back from `RETURNING` no matter which fires first.
    const { seller, buyer, review } = await reviewed();
    const admin = await makeUser({ role: "admin" });

    const [first, second] = await Promise.all([
      remove(review.id, authHeaderFor(buyer)),
      remove(review.id, authHeaderFor(admin)),
    ]);

    // Both answer 200 -- the caller asked for the review to be gone and it is, whether
    // this request or the other one removed it. Which of the two actually matched the
    // row in `RETURNING` is not the point -- the aggregate must land at zero either way,
    // never negative.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 0, ratingSum: 0 });
  });
});

describe("PATCH /api/reviews/[id] — races a concurrent DELETE", () => {
  it("answers 404, not 500, when the review is deleted between the outer read and the lock", async () => {
    // The interleaving this covers -- PATCH's outer read finds the review, then a
    // concurrent DELETE commits before PATCH's `SELECT ... FOR UPDATE` runs -- has no
    // hook to synchronise on from a test: nothing observable marks the instant PATCH is
    // between its outer read and its transaction. `Promise.all` alone lands in that
    // window often enough to demonstrate it (observed ~60% of single attempts in this
    // environment) but not every time, so this retries with a fresh review each attempt
    // instead of asserting on one. The "never 500" assertion runs on every attempt
    // regardless of whether that attempt hit the race -- it is what would catch a
    // regression on `ReviewGoneError`'s handling even on an unlucky run.
    let hitTheRace = false;

    for (let attempt = 0; attempt < 25 && !hitTheRace; attempt++) {
      const { buyer, review } = await reviewed();

      const [delRes, patchRes] = await Promise.all([
        remove(review.id, authHeaderFor(buyer)),
        patch(review.id, { rating: 5 }, authHeaderFor(buyer)),
      ]);

      expect(patchRes.status).not.toBe(500);

      if (patchRes.status === 404) {
        hitTheRace = true;
        expect(delRes.status).toBe(200);
        expect(patchRes.body).toMatchObject({ error: "Review not found" });
      }
    }

    expect(hitTheRace).toBe(true);
  });
});
