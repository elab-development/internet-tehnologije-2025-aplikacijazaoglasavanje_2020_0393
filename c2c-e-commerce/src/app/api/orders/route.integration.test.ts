/**
 * Part 3 spec §5.2 — reservation, through the route.
 *
 * The concurrency case is the reason this part exists: two buyers, one second-hand
 * object, and exactly one of them may end up owning it.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { listings, orders } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb();
});

async function place(
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("./route");
  const response = await POST(
    new NextRequest("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function list(headers: Record<string, string>) {
  const { GET } = await import("./route");
  const response = await GET(new NextRequest("http://localhost/api/orders", { headers }));
  return { status: response.status, body: await response.json() };
}

async function statusOf(listingId: number): Promise<string> {
  const db = await getTestDb();
  const [row] = await db
    .select({ status: listings.status })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  return row.status;
}

describe("POST /api/orders — the happy path", () => {
  it("creates the order and reserves the listing", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ price: "250.00" });

    const { status, body } = await place(authHeaderFor(buyer), { listingId: listing.id });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      buyerId: buyer.id,
      listingId: listing.id,
      sellerId: listing.sellerId,
      price: "250.00",
      status: "pending",
    });
    expect(await statusOf(listing.id)).toBe("reserved");
  });

  it("prices the order from the listing, never from the body", async () => {
    // The old route trusted a client-supplied quantity and multiplied by it. Anything the
    // client sends beyond `listingId` is ignored.
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ price: "250.00" });

    const { body } = await place(authHeaderFor(buyer), {
      listingId: listing.id,
      price: "0.01",
      quantity: 99,
    });

    expect(body.price).toBe("250.00");
  });

  it("gives the order a deadline 48 hours out", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing();

    const { body } = await place(authHeaderFor(buyer), { listingId: listing.id });

    const expiresAt = new Date(body.expiresAt as string).getTime();
    const createdAt = new Date(body.createdAt as string).getTime();
    expect(expiresAt - createdAt).toBeCloseTo(48 * HOUR, -3);
  });

  it("lets a seller buy from another seller (D5)", async () => {
    const buyerSeller = await makeUser({ role: "seller" });
    const listing = await makeListing();

    const { status } = await place(authHeaderFor(buyerSeller), { listingId: listing.id });

    expect(status).toBe(201);
  });
});

describe("POST /api/orders — the refusals", () => {
  it("answers 401 to an anonymous caller", async () => {
    const listing = await makeListing();
    const { status } = await place({}, { listingId: listing.id });
    expect(status).toBe(401);
  });

  it("answers 403 to a seller buying their own listing", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    const { status } = await place(authHeaderFor(seller), { listingId: listing.id });

    expect(status).toBe(403);
    // The refusal must not leave the listing held.
    expect(await statusOf(listing.id)).toBe("active");
  });

  it("answers 404 for a listing that does not exist", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const { status } = await place(authHeaderFor(buyer), { listingId: 999_999 });
    expect(status).toBe(404);
  });

  it("answers 404 for a draft or removed listing", async () => {
    const buyer = await makeUser({ role: "buyer" });

    for (const listingStatus of ["draft", "removed"] as const) {
      const listing = await makeListing({ status: listingStatus });
      const { status } = await place(authHeaderFor(buyer), { listingId: listing.id });
      expect(status, listingStatus).toBe(404);
    }
  });

  it("answers 409 for a listing someone else has already reserved", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() + HOUR),
    });

    const { status } = await place(authHeaderFor(buyer), { listingId: listing.id });

    expect(status).toBe(409);
  });

  it("answers 409 for a sold listing with a live order still holding it", async () => {
    // A confirmed order, not a bare status: since task 15, a `sold` listing whose order
    // was deleted is meant to become purchasable again (that is the fix), so what keeps
    // this one off the market has to be the order behind it, not the label alone.
    const buyer = await makeUser({ role: "buyer" });
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    await makeOrder({ listingId: listing.id, sellerId: seller.id, status: "confirmed" });

    const { status } = await place(authHeaderFor(buyer), { listingId: listing.id });

    expect(status).toBe(409);
  });

  it("answers 400 for the old cart-shaped body", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing();

    const { status } = await place(authHeaderFor(buyer), {
      items: [{ listingId: listing.id }],
    });

    expect(status).toBe(400);
  });
});

describe("POST /api/orders — the race", () => {
  it("lets exactly one of two simultaneous buyers through", async () => {
    // The case the old route could not survive: both buyers passed `status = 'active'`,
    // the lock serialised the writes, and the marketplace sold one bicycle twice.
    const a = await makeUser({ role: "buyer" });
    const b = await makeUser({ role: "buyer" });
    const listing = await makeListing();

    const [first, second] = await Promise.all([
      place(authHeaderFor(a), { listingId: listing.id }),
      place(authHeaderFor(b), { listingId: listing.id }),
    ]);

    const codes = [first.status, second.status].sort();
    expect(codes).toEqual([201, 409]);

    const db = await getTestDb();
    const rows = await db.select().from(orders).where(eq(orders.listingId, listing.id));
    expect(rows).toHaveLength(1);
  });

  it("leaves the listing reserved exactly once", async () => {
    const a = await makeUser({ role: "buyer" });
    const b = await makeUser({ role: "buyer" });
    const c = await makeUser({ role: "buyer" });
    const listing = await makeListing();

    const results = await Promise.all([
      place(authHeaderFor(a), { listingId: listing.id }),
      place(authHeaderFor(b), { listingId: listing.id }),
      place(authHeaderFor(c), { listingId: listing.id }),
    ]);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await statusOf(listing.id)).toBe("reserved");
  });
});

describe("POST /api/orders — lazy expiry (D4)", () => {
  it("takes over a listing whose reservation has lapsed", async () => {
    const stale = await makeUser({ role: "buyer" });
    const fresh = await makeUser({ role: "buyer" });
    const listing = await makeListing({ status: "reserved" });
    const abandoned = await makeOrder({
      buyerId: stale.id,
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() - HOUR),
    });

    const { status } = await place(authHeaderFor(fresh), { listingId: listing.id });

    expect(status).toBe(201);

    // Correctness does not wait for the sweep: the reserve path expired it.
    const db = await getTestDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, abandoned.id));
    expect(row.status).toBe("expired");
  });

  it("does not take over a reservation that is still live", async () => {
    const holder = await makeUser({ role: "buyer" });
    const other = await makeUser({ role: "buyer" });
    const listing = await makeListing({ status: "reserved" });
    const live = await makeOrder({
      buyerId: holder.id,
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() + HOUR),
    });

    const { status } = await place(authHeaderFor(other), { listingId: listing.id });

    expect(status).toBe(409);

    const db = await getTestDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, live.id));
    expect(row.status).toBe("pending");
  });
});

describe("GET /api/orders", () => {
  it("returns only the caller's own purchases", async () => {
    const mine = await makeUser({ role: "buyer" });
    const theirs = await makeUser({ role: "buyer" });
    const a = await makeOrder({ buyerId: mine.id });
    await makeOrder({ buyerId: theirs.id });

    const { status, body } = await list(authHeaderFor(mine));

    expect(status).toBe(200);
    expect((body.data as { id: number }[]).map((o) => o.id)).toEqual([a.id]);
  });

  it("returns a seller's own purchases, not their sales", async () => {
    // A seller's sales are `/api/orders/seller`. This endpoint is what the caller bought,
    // whatever role they hold.
    const seller = await makeUser({ role: "seller" });
    const bought = await makeOrder({ buyerId: seller.id });
    await makeOrder({ sellerId: seller.id });

    const { body } = await list(authHeaderFor(seller));

    expect((body.data as { id: number }[]).map((o) => o.id)).toEqual([bought.id]);
  });

  it("returns every order to an admin", async () => {
    const admin = await makeUser({ role: "admin" });
    await makeOrder();
    await makeOrder();

    const { body } = await list(authHeaderFor(admin));

    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
  });

  it("answers 401 to an anonymous caller", async () => {
    const { status } = await list({});
    expect(status).toBe(401);
  });
});

describe("POST /api/orders — the residual conflict the unique index catches", () => {
  it("answers 409, not 500, when an admin relists a sold listing a confirmed order still holds", async () => {
    // Half 1 does not close the admin path: admins are deliberately unrestricted and can
    // relist a listing a live order still holds. `claimListing`'s conditional UPDATE would
    // then succeed against the relisted `active` row, and the INSERT would hit
    // orders_one_live_per_listing_idx. That must come back as a 409, not an unmapped 500.
    const seller = await makeUser({ role: "seller" });
    const admin = await makeUser({ role: "admin" });
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    await makeOrder({ listingId: listing.id, sellerId: seller.id, status: "confirmed" });

    const { PUT } = await import("../listings/[id]/route");
    const relist = await PUT(
      new NextRequest(`http://localhost/api/listings/${listing.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaderFor(admin) },
        body: JSON.stringify({ status: "active" }),
      }),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );
    expect(relist.status).toBe(200);

    const { status } = await place(authHeaderFor(buyer), { listingId: listing.id });

    expect(status).toBe(409);

    const db = await getTestDb();
    const rows = await db.select().from(orders).where(eq(orders.listingId, listing.id));
    expect(rows).toHaveLength(1);
  });
});
