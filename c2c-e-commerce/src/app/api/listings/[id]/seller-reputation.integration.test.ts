/**
 * Part 4 spec §6.4 — the listing detail carries its seller's reputation.
 *
 * One join that was already there, and no `GROUP BY` over reviews. That is what
 * denormalising the aggregates (D7) was for: a seller card on every listing page for the
 * price of two integers.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDb } from "@/test/db";
import { makeListing, makeOrder, makeReview, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function readListing(id: number) {
  const { GET } = await import("./route");
  const response = await GET(new NextRequest(`http://localhost/api/listings/${id}`), {
    params: Promise.resolve({ id: String(id) }),
  });
  return { status: response.status, body: await response.json() };
}

describe("GET /api/listings/[id] — the seller's reputation", () => {
  it("carries name, avatar and both counters, so the page needs no second request", async () => {
    const seller = await makeUser({ role: "seller", name: "Ada Seller", avatarUrl: "/ada.png" });
    const listing = await makeListing({ sellerId: seller.id });
    const order = await makeOrder({ sellerId: seller.id, status: "completed" });
    await makeReview({ orderId: order.id, reviewerId: order.buyerId, rating: 4 });

    const { status, body } = await readListing(listing.id);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      sellerName: "Ada Seller",
      sellerAvatarUrl: "/ada.png",
      sellerReviewCount: 1,
      sellerRatingSum: 4,
    });
  });

  it("reports zeroes for a seller nobody has reviewed", async () => {
    // Not null: the columns are NOT NULL with a default of 0, and the UI derives "no
    // rating" from the count rather than from a missing field.
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    const { body } = await readListing(listing.id);

    expect(body).toMatchObject({ sellerReviewCount: 0, sellerRatingSum: 0 });
  });

  it("still does not publish the seller's embedding or contact details", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    const { body } = await readListing(listing.id);
    const raw = JSON.stringify(body);

    expect(raw).not.toContain("@example.test");
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("$2b$");
  });
});
