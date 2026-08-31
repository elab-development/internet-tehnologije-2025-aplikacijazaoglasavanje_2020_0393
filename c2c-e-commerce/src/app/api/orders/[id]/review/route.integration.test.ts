/**
 * Part 4 spec §6.2/§6.3 — POST /api/orders/[id]/review.
 *
 * Eligibility is one predicate over one row: the caller is this order's buyer and this
 * order completed. The duplicate check is the unique index, which is what makes the
 * concurrent case at the bottom of this file answer 409 rather than 500.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { reviews, users } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function post(
  orderId: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("./route");
  const response = await POST(
    new NextRequest(`http://localhost/api/orders/${orderId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(orderId) }) },
  );
  return { status: response.status, body: await response.json() };
}

/** A completed order between two fresh users, plus the buyer's token header. */
async function completedOrder() {
  const seller = await makeUser({ role: "seller" });
  const buyer = await makeUser({ role: "buyer" });
  const listing = await makeListing({ sellerId: seller.id, status: "sold" });
  const order = await makeOrder({
    buyerId: buyer.id,
    listingId: listing.id,
    status: "completed",
  });
  return { seller, buyer, listing, order };
}

describe("POST /api/orders/[id]/review — the happy path", () => {
  it("creates the review, anchored to the order and the seller", async () => {
    const { seller, buyer, order } = await completedOrder();

    const { status, body } = await post(
      order.id,
      { rating: 5, comment: "Arrived quickly." },
      authHeaderFor(buyer),
    );

    expect(status).toBe(201);
    expect(body).toMatchObject({
      reviewerId: buyer.id,
      sellerId: seller.id,
      orderId: order.id,
      rating: 5,
      comment: "Arrived quickly.",
    });
  });

  it("moves the seller's aggregates in the same breath", async () => {
    const db = await getTestDb();
    const { seller, buyer, order } = await completedOrder();

    await post(order.id, { rating: 4 }, authHeaderFor(buyer));

    const [row] = await db.select().from(users).where(eq(users.id, seller.id));
    expect(row.reviewCount).toBe(1);
    expect(row.ratingSum).toBe(4);
  });

  it("stores a blank comment as null", async () => {
    const { buyer, order } = await completedOrder();

    const { body } = await post(order.id, { rating: 3, comment: "   " }, authHeaderFor(buyer));

    expect(body.comment).toBeNull();
  });
});

describe("POST /api/orders/[id]/review — who may not", () => {
  it("rejects an anonymous caller with 401", async () => {
    const { order } = await completedOrder();
    expect((await post(order.id, { rating: 5 })).status).toBe(401);
  });

  it("hides the order from a stranger with 404, not 403", async () => {
    // Order ids are sequential; a 403 would confirm which ones are real.
    const { order } = await completedOrder();
    const stranger = await makeUser({ role: "buyer" });

    const { status } = await post(order.id, { rating: 5 }, authHeaderFor(stranger));

    expect(status).toBe(404);
  });

  it("refuses the seller of that order with 403", async () => {
    // Reviews are one-directional (D6): the seller can read this order and still has
    // nothing to say about it here.
    const { seller, order } = await completedOrder();

    const { status } = await post(order.id, { rating: 1 }, authHeaderFor(seller));

    expect(status).toBe(403);
  });

  it("refuses an admin, who can read the order but did not buy anything", async () => {
    const { order } = await completedOrder();
    const admin = await makeUser({ role: "admin" });

    const { status } = await post(order.id, { rating: 5 }, authHeaderFor(admin));

    expect(status).toBe(403);
  });

  it("refuses every status but completed", async () => {
    for (const status of ["pending", "confirmed", "shipped", "cancelled", "declined", "expired"] as const) {
      await resetDb();
      const seller = await makeUser({ role: "seller" });
      const buyer = await makeUser({ role: "buyer" });
      const listing = await makeListing({ sellerId: seller.id });
      const order = await makeOrder({ buyerId: buyer.id, listingId: listing.id, status });

      const response = await post(order.id, { rating: 5 }, authHeaderFor(buyer));

      expect(response.status, status).toBe(403);
    }
  });

  it("answers 404 for an order that does not exist", async () => {
    const buyer = await makeUser({ role: "buyer" });
    expect((await post(999_999, { rating: 5 }, authHeaderFor(buyer))).status).toBe(404);
  });

  it("answers 400 for a rating outside 1-5", async () => {
    const { buyer, order } = await completedOrder();
    expect((await post(order.id, { rating: 9 }, authHeaderFor(buyer))).status).toBe(400);
  });

  it("decides authorisation before it validates the body", async () => {
    // A stranger sending nonsense must not learn from a 400 that the order is real.
    const { order } = await completedOrder();
    const stranger = await makeUser({ role: "buyer" });

    const { status } = await post(order.id, { rating: 99 }, authHeaderFor(stranger));

    expect(status).toBe(404);
  });
});

describe("POST /api/orders/[id]/review — one review per transaction", () => {
  it("answers 409 on a second review of the same order", async () => {
    const { buyer, order } = await completedOrder();

    await post(order.id, { rating: 5 }, authHeaderFor(buyer));
    const { status } = await post(order.id, { rating: 1 }, authHeaderFor(buyer));

    expect(status).toBe(409);
  });

  it("leaves the aggregates untouched by the refused write", async () => {
    const db = await getTestDb();
    const { seller, buyer, order } = await completedOrder();

    await post(order.id, { rating: 5 }, authHeaderFor(buyer));
    await post(order.id, { rating: 1 }, authHeaderFor(buyer));

    const [row] = await db.select().from(users).where(eq(users.id, seller.id));
    expect(row).toMatchObject({ reviewCount: 1, ratingSum: 5 });
  });

  it("gives exactly one 201 and one 409 to two concurrent posts (spec §7)", async () => {
    const db = await getTestDb();
    const { seller, buyer, order } = await completedOrder();

    const [first, second] = await Promise.all([
      post(order.id, { rating: 5 }, authHeaderFor(buyer)),
      post(order.id, { rating: 4 }, authHeaderFor(buyer)),
    ]);

    const codes = [first.status, second.status].sort();
    expect(codes).toEqual([201, 409]);

    expect(await db.select().from(reviews).where(eq(reviews.orderId, order.id))).toHaveLength(1);

    const [row] = await db.select().from(users).where(eq(users.id, seller.id));
    expect(row.reviewCount).toBe(1);
  });
});
