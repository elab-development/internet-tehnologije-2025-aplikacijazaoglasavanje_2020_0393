/**
 * C2C-QA-3 spec — the factories and the auth helper.
 *
 * Also carries the second half of AC8: it asserts the same postmaster as
 * `test-db.integration.test.ts`, which is only meaningful because it is a *different file*.
 */
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, inject, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import { categories, listings, orders, reviews, users } from "@/db/schema";

import { authHeaderFor } from "../auth";
import { getTestDb, resetDb } from "../db";
import { makeCategory, makeListing, makeOrder, makeReview, makeUser } from "../factories";

beforeEach(async () => {
  await resetDb();
});

describe("C2C-QA-3 — makeUser", () => {
  it("AC5: creates a user with no arguments and returns the row", async () => {
    const user = await makeUser();

    expect(user.id).toEqual(expect.any(Number));
    expect(user.email).toEqual(expect.any(String));
    expect(user.role).toBe("buyer");
  });

  it("AC5: every field is overridable", async () => {
    const user = await makeUser({ role: "admin", name: "Ada", email: "ada@example.com" });

    expect(user.role).toBe("admin");
    expect(user.name).toBe("Ada");
    expect(user.email).toBe("ada@example.com");
  });

  it("AC5: two calls do not collide on the unique email column", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    expect(a.email).not.toBe(b.email);
  });

  it("AC5: the stored password is hashed, never the plaintext", async () => {
    const user = await makeUser({ password: "correct horse battery staple" });
    expect(user.passwordHash).not.toContain("correct horse");
  });
});

describe("C2C-QA-3 — makeCategory", () => {
  it("AC5: creates a category with a unique slug on repeated calls", async () => {
    const [a, b] = [await makeCategory(), await makeCategory()];

    expect(a.id).toEqual(expect.any(Number));
    expect(a.slug).not.toBe(b.slug);
  });

  it("AC5: name and slug are overridable", async () => {
    const category = await makeCategory({ name: "Cycling", slug: "cycling" });
    expect(category).toMatchObject({ name: "Cycling", slug: "cycling" });
  });
});

describe("C2C-QA-3 — makeListing", () => {
  it("AC5: with no arguments it creates the user and category it needs", async () => {
    const listing = await makeListing();
    const db = await getTestDb();

    expect(listing.id).toEqual(expect.any(Number));

    // The point of AC5: a test that only cares about listings should not have to spell
    // out a seller and a category first.
    const [seller] = await db.select().from(users).where(eq(users.id, listing.sellerId));
    expect(seller).toBeDefined();
    expect(listing.categoryId).toEqual(expect.any(Number));
  });

  it("AC5: an explicit sellerId is reused rather than creating another user", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });
    const db = await getTestDb();

    expect(listing.sellerId).toBe(seller.id);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("AC5: the embedding is null unless one is given", async () => {
    const listing = await makeListing();
    expect(listing.embedding).toBeNull();
  });

  it("AC5: an embedding can be supplied and round-trips at full width", async () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
      i === 0 ? 1 : 0,
    );
    const listing = await makeListing({ embedding: vector });

    expect(listing.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(listing.embedding?.[0]).toBeCloseTo(1, 5);
  });

  it("AC5: status and price are overridable, since AI-7 and AI-9 filter on both", async () => {
    const listing = await makeListing({ status: "sold", price: "42.50" });
    expect(listing).toMatchObject({ status: "sold", price: "42.50" });
  });
});

describe("C2C-QA-3 — makeOrder and makeReview", () => {
  it("AC5: makeOrder creates a buyer, a listing and the order between them", async () => {
    const order = await makeOrder();
    const db = await getTestDb();

    expect(order.id).toEqual(expect.any(Number));
    expect(order.listingId).toEqual(expect.any(Number));

    // The seller is captured from the listing, which is what a real order does — the
    // recommendations query and the seller dashboard both read it off the order.
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, order.listingId));
    expect(order.sellerId).toBe(listing.sellerId);

    const [buyer] = await db.select().from(users).where(eq(users.id, order.buyerId));
    expect(buyer).toBeDefined();
  });

  it("AC5: makeOrder accepts an explicit listing, and prices the order from it", async () => {
    const listing = await makeListing({ price: "42.50" });
    const order = await makeOrder({ listingId: listing.id });

    expect(order.listingId).toBe(listing.id);
    expect(order.price).toBe("42.50");
  });

  it("AC5: makeOrder gives the order a deadline, so it is not swept immediately", async () => {
    const order = await makeOrder();
    expect(order.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("AC5: makeReview creates a reviewer and a listing, with a valid rating", async () => {
    const review = await makeReview();

    expect(review.id).toEqual(expect.any(Number));
    // The reviews table has a CHECK (rating BETWEEN 1 AND 5); a default outside it would
    // make the factory unusable.
    expect(review.rating).toBeGreaterThanOrEqual(1);
    expect(review.rating).toBeLessThanOrEqual(5);
  });

  it("AC5: makeReview honours an explicit rating and listing", async () => {
    const listing = await makeListing();
    const review = await makeReview({ listingId: listing.id, rating: 5 });

    expect(review).toMatchObject({ listingId: listing.id, rating: 5 });
  });

  it("AC5: factories leave nothing behind that resetDb cannot clear", async () => {
    await makeOrder();
    await makeReview();
    await resetDb();

    const db = await getTestDb();
    for (const table of [users, categories, listings, orders, reviews]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
  });
});

describe("C2C-QA-3 — authHeaderFor", () => {
  it("AC6: an admin's header authenticates against a real route handler", async () => {
    const user = await makeUser({ role: "admin" });
    const { GET } = await import("@/app/api/auth/me/route");

    const response = await GET(
      new NextRequest("http://localhost/api/auth/me", {
        headers: authHeaderFor(user),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toMatchObject({ id: user.id, role: "admin" });
  });

  it("AC6: the header never carries the password hash back to the caller", async () => {
    const user = await makeUser({ role: "admin" });
    const { GET } = await import("@/app/api/auth/me/route");

    const response = await GET(
      new NextRequest("http://localhost/api/auth/me", {
        headers: authHeaderFor(user),
      }),
    );

    expect(JSON.stringify(await response.json())).not.toContain("passwordHash");
  });

  it("AC6: without the header the same route answers 401", async () => {
    await makeUser({ role: "admin" });
    const { GET } = await import("@/app/api/auth/me/route");

    const response = await GET(new NextRequest("http://localhost/api/auth/me"));
    expect(response.status).toBe(401);
  });

  it("AC6: produces a Bearer header, not a bare token", async () => {
    const user = await makeUser();
    expect(authHeaderFor(user).Authorization).toMatch(/^Bearer \S+\.\S+\.\S+$/);
  });
});

describe("C2C-QA-3 — one container for the whole run", () => {
  it("AC8: a second test file shares the first file's postmaster", async () => {
    const db = await getTestDb();
    const result = await db.execute(sql`SELECT pg_postmaster_start_time() AS started`);

    expect(new Date(result.rows[0].started as string).toISOString()).toBe(
      inject("postmasterStartTime"),
    );
  });
});
