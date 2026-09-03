/**
 * Part 4 spec §6.3/§6.4 — GET /api/users/[id]/reviews.
 *
 * Public and paginated. `total` is read from `users.review_count` rather than counted,
 * which is what D7's two integers are for — and which means a drift between them and the
 * rows would show up here as broken pagination rather than as a wrong number nobody
 * notices.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { authHeaderFor } from "@/test/auth";
import { resetDb } from "@/test/db";
import { makeOrder, makeReview, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

type Body = {
  seller: {
    id: number;
    name: string;
    avatarUrl: string | null;
    reviewCount: number;
    ratingSum: number;
    averageRating: number | null;
  };
  data: { id: number; rating: number; reviewerName: string | null; orderId: number }[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

async function get(
  userId: number,
  query = "",
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Body }> {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/users/${userId}/reviews?${query}`, { headers }),
    { params: Promise.resolve({ id: String(userId) }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

/** A seller with `count` reviews, oldest first, rated 1..5 cycling. */
async function sellerWithReviews(count: number) {
  const seller = await makeUser({ role: "seller", name: "Ada Seller", avatarUrl: "/a.png" });

  for (let i = 0; i < count; i++) {
    const order = await makeOrder({ sellerId: seller.id, status: "completed" });
    await makeReview({
      orderId: order.id,
      reviewerId: order.buyerId,
      rating: (i % 5) + 1,
      createdAt: new Date(Date.UTC(2026, 0, i + 1)),
    });
  }

  return seller;
}

describe("GET /api/users/[id]/reviews — the summary", () => {
  it("is public: no token, still answers", async () => {
    const seller = await sellerWithReviews(1);
    expect((await get(seller.id)).status).toBe(200);
  });

  it("reports the seller's name, avatar and derived average", async () => {
    // Ratings 1..5 across five reviews: sum 15, mean 3.
    const seller = await sellerWithReviews(5);

    const { body } = await get(seller.id);

    expect(body.seller).toEqual({
      id: seller.id,
      name: "Ada Seller",
      avatarUrl: "/a.png",
      reviewCount: 5,
      ratingSum: 15,
      averageRating: 3,
    });
  });

  it("reports no rating at all for a seller nobody has reviewed", async () => {
    // Null rather than 0, which would render as five one-star reviews.
    const seller = await makeUser({ role: "seller" });

    const { body } = await get(seller.id);

    expect(body.seller.averageRating).toBeNull();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.totalPages).toBe(1);
  });

  it("never leaks anything else off the users row", async () => {
    // `GET /api/users/{id}` is isSelfOrAdmin and stays that way. This endpoint publishes
    // a display identity and a reputation, and that is the whole of it.
    const seller = await sellerWithReviews(1);

    const { body } = await get(seller.id);
    const raw = JSON.stringify(body.seller);

    expect(Object.keys(body.seller).sort()).toEqual([
      "avatarUrl",
      "averageRating",
      "id",
      "name",
      "ratingSum",
      "reviewCount",
    ]);
    expect(raw).not.toContain("@example.test");
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("$2b$");
  });

  it("answers 404 for a user who does not exist", async () => {
    expect((await get(999_999)).status).toBe(404);
  });

  it("answers 400 for an id that is not a positive integer", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/users/abc/reviews"),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/users/[id]/reviews — the list", () => {
  it("returns the newest review first, with its reviewer's name", async () => {
    const seller = await sellerWithReviews(3);

    const { body } = await get(seller.id);

    expect(body.data).toHaveLength(3);
    // Ratings were 1, 2, 3 oldest-to-newest, so newest-first starts at 3.
    expect(body.data.map((r) => r.rating)).toEqual([3, 2, 1]);
    expect(body.data[0].reviewerName).toEqual(expect.any(String));
  });

  it("paginates, taking its total from the denormalised count", async () => {
    const seller = await sellerWithReviews(7);

    const first = await get(seller.id, "page=1&limit=3");
    const last = await get(seller.id, "page=3&limit=3");

    expect(first.body).toMatchObject({ total: 7, page: 1, limit: 3, totalPages: 3 });
    expect(first.body.data).toHaveLength(3);
    expect(last.body.data).toHaveLength(1);
  });

  it("returns an empty page rather than an error past the end", async () => {
    const seller = await sellerWithReviews(2);

    const { status, body } = await get(seller.id, "page=9&limit=10");

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("ignores junk pagination instead of answering 400", async () => {
    const seller = await sellerWithReviews(2);

    const { body } = await get(seller.id, "page=-4&limit=notanumber");

    expect(body).toMatchObject({ page: 1, limit: 20 });
    expect(body.data).toHaveLength(2);
  });

  it("caps the page size", async () => {
    const seller = await sellerWithReviews(1);
    expect((await get(seller.id, "limit=5000")).body.limit).toBe(100);
  });

  it("shows only this seller's reviews", async () => {
    const seller = await sellerWithReviews(2);
    const other = await sellerWithReviews(3);

    const { body } = await get(seller.id);

    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(other.id).not.toBe(seller.id);
  });

  it("shows the same reviews to an authenticated stranger", async () => {
    const seller = await sellerWithReviews(2);
    const stranger = await makeUser({ role: "buyer" });

    const { body } = await get(seller.id, "", authHeaderFor(stranger));

    expect(body.data).toHaveLength(2);
  });
});
