/**
 * C2C-SEC-10 spec — the RBAC matrix, exercised against real routes.
 *
 * One assertion per row of `docs/security/rbac-matrix.md`. Two rules run through all of
 * it:
 *
 *   401 vs 403 — unauthenticated is 401, authenticated-but-not-permitted is 403,
 *   consistently, so a client can tell "log in" from "you cannot do this".
 *
 *   404 over 403 where a 403 would itself disclose something. Answering 403 for
 *   another user's order confirms that order exists; answering 404 tells a prober
 *   nothing they did not already know.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { listings, orders, reviews, users } from "@/db/schema";
import { resetRateLimits } from "@/lib/rate-limit";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import {
  makeCategory,
  makeListing,
  makeOrder,
  makeReview,
  makeUser,
} from "@/test/factories";

let counter = 0;
const nextIp = () => `10.5.0.${(counter += 1) % 250}`;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

type Ctx = { params: Promise<Record<string, string>> };

async function call(
  modulePath: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; params?: Record<string, string> } = {},
) {
  const mod = (await import(modulePath)) as Record<string, unknown>;
  const handler = mod[method] as (
    req: NextRequest,
    ctx?: Ctx,
  ) => Promise<Response>;

  const request = new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextIp(),
      ...(opts.headers ?? {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

  return opts.params
    ? handler(request, { params: Promise.resolve(opts.params) })
    : handler(request);
}

// ─── Listings ─────────────────────────────────────────────────────────────────

describe("C2C-SEC-10 AC2 — PUT/DELETE /api/listings/[id]", () => {
  it("lets the owning seller update", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    const response = await call("./listings/[id]/route", "PUT", `/api/listings/${listing.id}`, {
      headers: authHeaderFor(seller),
      body: { title: "Updated" },
      params: { id: String(listing.id) },
    });

    expect(response.status).toBe(200);
  });

  it("refuses a different seller with 403 and leaves the row alone", async () => {
    const owner = await makeUser({ role: "seller" });
    const stranger = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: owner.id, title: "Original" });

    const response = await call("./listings/[id]/route", "PUT", `/api/listings/${listing.id}`, {
      headers: authHeaderFor(stranger),
      body: { title: "Hijacked" },
      params: { id: String(listing.id) },
    });

    expect(response.status).toBe(403);

    const db = await getTestDb();
    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.title).toBe("Original");
  });

  it("refuses a different seller's DELETE with 403", async () => {
    const owner = await makeUser({ role: "seller" });
    const stranger = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: owner.id });

    const response = await call(
      "./listings/[id]/route",
      "DELETE",
      `/api/listings/${listing.id}`,
      { headers: authHeaderFor(stranger), params: { id: String(listing.id) } },
    );

    expect(response.status).toBe(403);
    const db = await getTestDb();
    expect(await db.select().from(listings)).toHaveLength(1);
  });

  it("AC8: answers 401 when unauthenticated", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    const response = await call("./listings/[id]/route", "PUT", `/api/listings/${listing.id}`, {
      body: { title: "x" },
      params: { id: String(listing.id) },
    });

    expect(response.status).toBe(401);
  });

  it("AC10: lets an admin update anyone's listing", async () => {
    const seller = await makeUser({ role: "seller" });
    const admin = await makeUser({ role: "admin" });
    const listing = await makeListing({ sellerId: seller.id });

    const response = await call("./listings/[id]/route", "PUT", `/api/listings/${listing.id}`, {
      headers: authHeaderFor(admin),
      body: { title: "Moderated" },
      params: { id: String(listing.id) },
    });

    expect(response.status).toBe(200);
  });
});

// ─── Orders ───────────────────────────────────────────────────────────────────

describe("C2C-SEC-10 AC3 — GET /api/orders/[id] hides existence", () => {
  it("answers 404, not 403, for another buyer's order", async () => {
    const owner = await makeUser({ role: "buyer" });
    const stranger = await makeUser({ role: "buyer" });
    const order = await makeOrder({ buyerId: owner.id });

    const response = await call("./orders/[id]/route", "GET", `/api/orders/${order.id}`, {
      headers: authHeaderFor(stranger),
      params: { id: String(order.id) },
    });

    // 403 would confirm the order exists. A prober walking ids must not be able to
    // tell "yours" from "someone's" from "nobody's".
    expect(response.status).toBe(404);
  });

  it("answers 404 identically for an order that does not exist", async () => {
    const stranger = await makeUser({ role: "buyer" });

    const response = await call("./orders/[id]/route", "GET", "/api/orders/999999", {
      headers: authHeaderFor(stranger),
      params: { id: "999999" },
    });

    expect(response.status).toBe(404);
  });

  it("gives the same body in both cases", async () => {
    const owner = await makeUser({ role: "buyer" });
    const stranger = await makeUser({ role: "buyer" });
    const order = await makeOrder({ buyerId: owner.id });

    const theirs = await call("./orders/[id]/route", "GET", `/api/orders/${order.id}`, {
      headers: authHeaderFor(stranger),
      params: { id: String(order.id) },
    });
    const missing = await call("./orders/[id]/route", "GET", "/api/orders/999999", {
      headers: authHeaderFor(stranger),
      params: { id: "999999" },
    });

    // A different message would reintroduce the oracle the status code just closed.
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("lets the owning buyer read it", async () => {
    const owner = await makeUser({ role: "buyer" });
    const order = await makeOrder({ buyerId: owner.id });

    const response = await call("./orders/[id]/route", "GET", `/api/orders/${order.id}`, {
      headers: authHeaderFor(owner),
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(200);
  });

  it("lets the selling seller read it", async () => {
    const seller = await makeUser({ role: "seller" });
    const order = await makeOrder({ sellerId: seller.id });

    const response = await call("./orders/[id]/route", "GET", `/api/orders/${order.id}`, {
      headers: authHeaderFor(seller),
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(200);
  });

  it("lets an admin read anyone's", async () => {
    const owner = await makeUser({ role: "buyer" });
    const admin = await makeUser({ role: "admin" });
    const order = await makeOrder({ buyerId: owner.id });

    const response = await call("./orders/[id]/route", "GET", `/api/orders/${order.id}`, {
      headers: authHeaderFor(admin),
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(200);
  });
});

describe("C2C-SEC-10 AC4/AC5 — PUT /api/orders/[id]", () => {
  /** A pending order between these two, on a listing the seller owns. */
  async function orderFor(seller: { id: number }, buyer: { id: number }) {
    const category = await makeCategory();
    const listing = await makeListing({
      sellerId: seller.id,
      categoryId: category.id,
      status: "reserved",
    });
    return makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      listingId: listing.id,
      status: "pending",
    });
  }

  it("AC4: hides the order from a seller who has no stake in it", async () => {
    // Part 3 changed this from 403 to 404. With `seller_id` on the order a non-party is
    // indistinguishable from a stranger, and a 403 on a sequential id enumerates orders.
    const owner = await makeUser({ role: "seller" });
    const stranger = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const order = await orderFor(owner, buyer);

    const response = await call("./orders/[id]/route", "PUT", `/api/orders/${order.id}`, {
      headers: authHeaderFor(stranger),
      body: { status: "confirmed" },
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(404);

    const db = await getTestDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("pending");
  });

  it("allows the seller the order names", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const order = await orderFor(seller, buyer);

    const response = await call("./orders/[id]/route", "PUT", `/api/orders/${order.id}`, {
      headers: authHeaderFor(seller),
      body: { status: "confirmed" },
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(200);
  });

  it("checks ownership before order state, so a stranger cannot read the status", async () => {
    const owner = await makeUser({ role: "seller" });
    const stranger = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const category = await makeCategory();
    const listing = await makeListing({ sellerId: owner.id, categoryId: category.id });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: owner.id,
      listingId: listing.id,
      status: "completed",
    });

    const response = await call("./orders/[id]/route", "PUT", `/api/orders/${order.id}`, {
      headers: authHeaderFor(stranger),
      body: { status: "confirmed" },
      params: { id: String(order.id) },
    });

    // Not 400 "only pending orders can be confirmed", which is a fact about someone
    // else's purchase.
    expect(response.status).toBe(404);
  });

  it("AC5: refuses a buyer confirming their own order, without hiding it from them", async () => {
    // The buyer IS a party, so this is 400 rather than 404: they may see their order,
    // they may not take the seller's decision for them.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const order = await orderFor(seller, buyer);

    const response = await call("./orders/[id]/route", "PUT", `/api/orders/${order.id}`, {
      headers: authHeaderFor(buyer),
      body: { status: "confirmed" },
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(400);

    const db = await getTestDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("pending");
  });
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

describe("C2C-SEC-10 AC6 — DELETE /api/reviews/[id]", () => {
  it("refuses someone else's review with 403", async () => {
    const author = await makeUser({ role: "buyer" });
    const stranger = await makeUser({ role: "buyer" });
    const review = await makeReview({ reviewerId: author.id });

    const response = await call("./reviews/[id]/route", "DELETE", `/api/reviews/${review.id}`, {
      headers: authHeaderFor(stranger),
      params: { id: String(review.id) },
    });

    expect(response.status).toBe(403);
    const db = await getTestDb();
    expect(await db.select().from(reviews)).toHaveLength(1);
  });

  it("lets the author delete it", async () => {
    const author = await makeUser({ role: "buyer" });
    const review = await makeReview({ reviewerId: author.id });

    const response = await call("./reviews/[id]/route", "DELETE", `/api/reviews/${review.id}`, {
      headers: authHeaderFor(author),
      params: { id: String(review.id) },
    });

    expect(response.status).toBe(200);
  });

  it("lets an admin delete any review", async () => {
    const author = await makeUser({ role: "buyer" });
    const admin = await makeUser({ role: "admin" });
    const review = await makeReview({ reviewerId: author.id });

    const response = await call("./reviews/[id]/route", "DELETE", `/api/reviews/${review.id}`, {
      headers: authHeaderFor(admin),
      params: { id: String(review.id) },
    });

    expect(response.status).toBe(200);
  });

  it("AC8: answers 401 when unauthenticated", async () => {
    const author = await makeUser({ role: "buyer" });
    const review = await makeReview({ reviewerId: author.id });

    const response = await call("./reviews/[id]/route", "DELETE", `/api/reviews/${review.id}`, {
      params: { id: String(review.id) },
    });

    expect(response.status).toBe(401);
  });
});

// ─── Users ────────────────────────────────────────────────────────────────────

describe("C2C-SEC-10 AC7 — PUT /api/users/[id] and roles", () => {
  it("refuses a self-service role change with 403", async () => {
    const buyer = await makeUser({ role: "buyer" });

    const response = await call("./users/[id]/route", "PUT", `/api/users/${buyer.id}`, {
      headers: authHeaderFor(buyer),
      body: { role: "admin" },
      params: { id: String(buyer.id) },
    });

    expect(response.status).toBe(403);

    const db = await getTestDb();
    const [row] = await db.select().from(users).where(eq(users.id, buyer.id));
    expect(row.role).toBe("buyer");
  });

  it("lets a user update their own name", async () => {
    const buyer = await makeUser({ role: "buyer" });

    const response = await call("./users/[id]/route", "PUT", `/api/users/${buyer.id}`, {
      headers: authHeaderFor(buyer),
      body: { name: "New Name" },
      params: { id: String(buyer.id) },
    });

    expect(response.status).toBe(200);
  });

  it("refuses editing another user with 403", async () => {
    const a = await makeUser({ role: "buyer" });
    const b = await makeUser({ role: "buyer" });

    const response = await call("./users/[id]/route", "PUT", `/api/users/${b.id}`, {
      headers: authHeaderFor(a),
      body: { name: "Hijacked" },
      params: { id: String(b.id) },
    });

    expect(response.status).toBe(403);
  });

  it("lets an admin grant admin", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser({ role: "buyer" });

    const response = await call("./users/[id]/route", "PUT", `/api/users/${target.id}`, {
      headers: authHeaderFor(admin),
      body: { role: "admin" },
      params: { id: String(target.id) },
    });

    expect(response.status).toBe(200);
  });
});

// ─── Cross-cutting ────────────────────────────────────────────────────────────

describe("C2C-SEC-10 AC9 — no response ever carries a password hash", () => {
  it("holds across every route that returns a user", async () => {
    const admin = await makeUser({ role: "admin" });
    const buyer = await makeUser({ role: "buyer" });

    const responses = await Promise.all([
      call("./auth/me/route", "GET", "/api/auth/me", { headers: authHeaderFor(buyer) }),
      call("./users/route", "GET", "/api/users", { headers: authHeaderFor(admin) }),
      call("./users/[id]/route", "GET", `/api/users/${buyer.id}`, {
        headers: authHeaderFor(buyer),
        params: { id: String(buyer.id) },
      }),
      call("./users/[id]/route", "PUT", `/api/users/${buyer.id}`, {
        headers: authHeaderFor(buyer),
        body: { name: "Renamed" },
        params: { id: String(buyer.id) },
      }),
    ]);

    for (const response of responses) {
      const raw = await response.text();
      expect(raw).not.toContain("passwordHash");
      expect(raw).not.toContain("password_hash");
      // The bcrypt prefix, in case a hash ever ships under a different key name.
      expect(raw).not.toContain("$2b$");
    }
  });
});

describe("C2C-SEC-10 AC8 — 401 before 403, consistently", () => {
  const protectedRoutes: Array<[string, "GET" | "POST" | "PUT" | "DELETE", string, Record<string, string>?]> = [
    ["./orders/route", "GET", "/api/orders"],
    ["./orders/seller/route", "GET", "/api/orders/seller"],
    ["./users/route", "GET", "/api/users"],
    ["./auth/me/route", "GET", "/api/auth/me"],
    ["./recommendations/route", "GET", "/api/recommendations"],
  ];

  for (const [modulePath, method, url] of protectedRoutes) {
    it(`answers 401 unauthenticated: ${method} ${url}`, async () => {
      const response = await call(modulePath, method, url);
      expect(response.status).toBe(401);
    });
  }

  it("answers 403, not 401, for an authenticated user with the wrong role", async () => {
    const buyer = await makeUser({ role: "buyer" });

    const response = await call("./users/route", "GET", "/api/users", {
      headers: authHeaderFor(buyer),
    });

    expect(response.status).toBe(403);
  });

  it("answers 403 for a buyer attempting an admin-only category write", async () => {
    const buyer = await makeUser({ role: "buyer" });

    const response = await call("./categories/route", "POST", "/api/categories", {
      headers: authHeaderFor(buyer),
      body: { name: "Sneaky", slug: "sneaky" },
    });

    expect(response.status).toBe(403);
  });
});
