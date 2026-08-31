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

    expect((await aggregatesOf(seller.id)).reviewCount).toBe(1);
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
});
