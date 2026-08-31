/**
 * Part 4 — `DELETE /api/users/{id}` and the reviews its cascade takes with it.
 *
 * Deleting a user cascades to the reviews they wrote, their orders on both sides, and —
 * through those orders — the reviews anchored to them (migration 0017's `ON DELETE
 * CASCADE`). Every one of those rows can be a review of some *other* seller's transaction,
 * and `users.review_count`/`rating_sum` are denormalised (D7): nothing but an explicit
 * write moves them back in step. `repairAggregatesBeforeUserDelete` is that write; these
 * tests are its coverage.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { users } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeOrder, makeReview, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function del(userId: number, headers: Record<string, string>) {
  const { DELETE } = await import("./route");
  const response = await DELETE(
    new NextRequest(`http://localhost/api/users/${userId}`, { method: "DELETE", headers }),
    { params: Promise.resolve({ id: String(userId) }) },
  );
  return { status: response.status, body: await response.json() };
}

async function aggregates(id: number): Promise<{ reviewCount: number; ratingSum: number }> {
  const db = await getTestDb();
  const [row] = await db
    .select({ reviewCount: users.reviewCount, ratingSum: users.ratingSum })
    .from(users)
    .where(eq(users.id, id));
  return row;
}

describe("DELETE /api/users/[id] — repairing the reviews the cascade takes with it", () => {
  it("reduces a seller's aggregates to match their surviving reviews", async () => {
    const admin = await makeUser({ role: "admin" });
    const seller = await makeUser({ role: "seller" });

    const reviewerToDelete = await makeUser({ role: "buyer" });
    const orderToDelete = await makeOrder({
      buyerId: reviewerToDelete.id,
      sellerId: seller.id,
      status: "completed",
    });
    await makeReview({ orderId: orderToDelete.id, reviewerId: reviewerToDelete.id, rating: 3 });

    const survivingReviewer = await makeUser({ role: "buyer" });
    const survivingOrder = await makeOrder({
      buyerId: survivingReviewer.id,
      sellerId: seller.id,
      status: "completed",
    });
    await makeReview({ orderId: survivingOrder.id, reviewerId: survivingReviewer.id, rating: 5 });

    expect(await aggregates(seller.id)).toEqual({ reviewCount: 2, ratingSum: 8 });

    const { status } = await del(reviewerToDelete.id, authHeaderFor(admin));

    expect(status).toBe(200);
    // Only the surviving review (rating 5) should remain in the seller's aggregates.
    expect(await aggregates(seller.id)).toEqual({ reviewCount: 1, ratingSum: 5 });
  });

  it("leaves an unrelated seller's aggregates untouched", async () => {
    const admin = await makeUser({ role: "admin" });

    const seller = await makeUser({ role: "seller" });
    const reviewer = await makeUser({ role: "buyer" });
    const order = await makeOrder({ buyerId: reviewer.id, sellerId: seller.id, status: "completed" });
    await makeReview({ orderId: order.id, reviewerId: reviewer.id, rating: 4 });

    // No order, no review, no relationship at all to `seller` or `reviewer`.
    const unrelated = await makeUser({ role: "buyer" });

    expect(await aggregates(seller.id)).toEqual({ reviewCount: 1, ratingSum: 4 });

    const { status } = await del(unrelated.id, authHeaderFor(admin));

    expect(status).toBe(200);
    expect(await aggregates(seller.id)).toEqual({ reviewCount: 1, ratingSum: 4 });
  });
});
