/**
 * Part 3 spec §5.3 — transitions, and the listing status each one implies.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { listings, orders } from "@/db/schema";
import type { OrderStatus } from "@/lib/order-lifecycle";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeReview, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

type Party = { id: number };

async function transition(
  orderId: number,
  headers: Record<string, string>,
  status: string,
) {
  const { PUT } = await import("./route");
  const response = await PUT(
    new NextRequest(`http://localhost/api/orders/${orderId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: String(orderId) }) },
  );
  return { status: response.status, body: await response.json() };
}

async function read(orderId: number, headers: Record<string, string>) {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/orders/${orderId}`, { headers }),
    { params: Promise.resolve({ id: String(orderId) }) },
  );
  return { status: response.status, body: await response.json() };
}

/** A pending order on a reserved listing — the state `POST /api/orders` leaves behind. */
async function pendingOrder(seller: Party, buyer: Party) {
  const listing = await makeListing({ sellerId: seller.id, status: "reserved" });
  const order = await makeOrder({
    buyerId: buyer.id,
    sellerId: seller.id,
    listingId: listing.id,
    status: "pending",
  });
  return { listing, order };
}

async function listingStatus(id: number): Promise<string> {
  const db = await getTestDb();
  const [row] = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, id));
  return row.status;
}

async function orderStatus(id: number): Promise<OrderStatus> {
  const db = await getTestDb();
  const [row] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id));
  return row.status;
}

describe("PUT /api/orders/[id] — who may drive what", () => {
  it("lets the seller confirm, and sells the listing", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(seller), "confirmed");

    expect(status).toBe(200);
    expect(await orderStatus(order.id)).toBe("confirmed");
    expect(await listingStatus(listing.id)).toBe("sold");
  });

  it("lets the seller decline, and returns the listing to browse", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(seller), "declined");

    expect(status).toBe(200);
    expect(await listingStatus(listing.id)).toBe("active");
  });

  it("lets the buyer cancel a pending order, and returns the listing to browse", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(buyer), "cancelled");

    expect(status).toBe(200);
    expect(await listingStatus(listing.id)).toBe("active");
  });

  it("refuses a buyer confirming their own order", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(buyer), "confirmed");

    expect(status).toBe(400);
    expect(await orderStatus(order.id)).toBe("pending");
    expect(await listingStatus(listing.id)).toBe("reserved");
  });

  it("refuses a seller cancelling instead of declining", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(seller), "cancelled");

    expect(status).toBe(400);
    expect(await orderStatus(order.id)).toBe("pending");
  });

  it("lets an admin drive any legal transition", async () => {
    const admin = await makeUser({ role: "admin" });
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(admin), "expired");

    expect(status).toBe(200);
    expect(await orderStatus(order.id)).toBe("expired");
  });

  it("refuses buyer and seller marking an order expired", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { order } = await pendingOrder(seller, buyer);

    expect((await transition(order.id, authHeaderFor(buyer), "expired")).status).toBe(400);
    expect((await transition(order.id, authHeaderFor(seller), "expired")).status).toBe(400);
  });
});

describe("PUT /api/orders/[id] — the rest of the graph", () => {
  async function confirmed(seller: Party, buyer: Party) {
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      listingId: listing.id,
      status: "confirmed",
    });
    return { listing, order };
  }

  it("lets the seller ship, leaving the listing sold", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await confirmed(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(seller), "shipped");

    expect(status).toBe(200);
    expect(await listingStatus(listing.id)).toBe("sold");
  });

  it("lets the buyer complete a shipped order, leaving the listing sold", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      listingId: listing.id,
      status: "shipped",
    });

    const { status } = await transition(order.id, authHeaderFor(buyer), "completed");

    expect(status).toBe(200);
    expect(await listingStatus(listing.id)).toBe("sold");
  });

  it("lets either party cancel after confirmation, and republishes the listing", async () => {
    for (const canceller of ["buyer", "seller"] as const) {
      await resetDb();
      const seller = await makeUser({ role: "seller" });
      const buyer = await makeUser({ role: "buyer" });
      const { listing, order } = await confirmed(seller, buyer);
      const who = canceller === "buyer" ? buyer : seller;

      const { status } = await transition(order.id, authHeaderFor(who), "cancelled");

      expect(status, canceller).toBe(200);
      expect(await listingStatus(listing.id)).toBe("active");
    }
  });

  it("refuses every transition out of a terminal state", async () => {
    const admin = await makeUser({ role: "admin" });
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });

    for (const from of ["completed", "cancelled", "declined", "expired"] as const) {
      const order = await makeOrder({ buyerId: buyer.id, sellerId: seller.id, status: from });
      const { status } = await transition(order.id, authHeaderFor(admin), "confirmed");
      expect(status, from).toBe(400);
    }
  });
});

describe("PUT /api/orders/[id] — when the listing is no longer sellable", () => {
  it("answers 409 and leaves the order pending when the listing has moved on", async () => {
    // The listing is not `reserved` any more, so the sale cannot be applied to it. The
    // order's own compare-and-set still succeeds — its status did not change under us —
    // and committing that alone is how a confirmed order comes to own nothing.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const db = await getTestDb();
    await db.update(listings).set({ status: "removed" }).where(eq(listings.id, listing.id));

    const { status } = await transition(order.id, authHeaderFor(seller), "confirmed");

    expect(status).toBe(409);
    expect(await orderStatus(order.id)).toBe("pending");
    expect(await listingStatus(listing.id)).toBe("removed");
  });

  it("still confirms the ordinary case", async () => {
    // The guard above must refuse a listing that moved, not confirmation in general.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(seller), "confirmed");

    expect(status).toBe(200);
    expect(await orderStatus(order.id)).toBe("confirmed");
    expect(await listingStatus(listing.id)).toBe("sold");
  });

  it("still cancels an order whose listing has moved on, rather than stranding it", async () => {
    // The `active` direction is deliberately not guarded: releasing a listing that is
    // already released is idempotent, and refusing the cancellation would leave the
    // order in a status its buyer cannot leave.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const db = await getTestDb();
    await db.update(listings).set({ status: "removed" }).where(eq(listings.id, listing.id));

    const { status } = await transition(order.id, authHeaderFor(buyer), "cancelled");

    expect(status).toBe(200);
    expect(await orderStatus(order.id)).toBe("cancelled");
    expect(await listingStatus(listing.id)).toBe("removed");
  });
});

describe("PUT /api/orders/[id] — hiding existence", () => {
  it("answers 404, not 403, to a stranger", async () => {
    // A 403 would confirm the order exists, and order ids are sequential.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const stranger = await makeUser({ role: "seller" });
    const { order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(stranger), "confirmed");

    expect(status).toBe(404);
    expect(await orderStatus(order.id)).toBe("pending");
  });

  it("gives a stranger the same answer for a real order and a missing one", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const stranger = await makeUser({ role: "seller" });
    const { order } = await pendingOrder(seller, buyer);

    const real = await transition(order.id, authHeaderFor(stranger), "confirmed");
    const missing = await transition(999_999, authHeaderFor(stranger), "confirmed");

    expect(real).toEqual(missing);
  });

  it("decides authorisation before it looks at the order's state", async () => {
    // "Only pending orders can be confirmed" would tell a stranger what state someone
    // else's purchase is in.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const stranger = await makeUser({ role: "seller" });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      status: "completed",
    });

    const { status } = await transition(order.id, authHeaderFor(stranger), "confirmed");

    expect(status).toBe(404);
  });
});

describe("GET /api/orders/[id]", () => {
  it("returns the order with its listing's title", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ title: "Road bike" });
    const order = await makeOrder({ buyerId: buyer.id, listingId: listing.id });

    const { status, body } = await read(order.id, authHeaderFor(buyer));

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: order.id, listingId: listing.id, listingTitle: "Road bike" });
  });

  it("lets the seller read their own sale", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });
    const order = await makeOrder({ sellerId: seller.id, listingId: listing.id });

    const { status } = await read(order.id, authHeaderFor(seller));

    expect(status).toBe(200);
  });

  it("answers 404 to a stranger", async () => {
    const stranger = await makeUser({ role: "buyer" });
    const order = await makeOrder();

    const { status } = await read(order.id, authHeaderFor(stranger));

    expect(status).toBe(404);
  });

  it("reports reviewId as null on an order nobody has reviewed", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const order = await makeOrder({ buyerId: buyer.id, status: "completed" });

    const { body } = await read(order.id, authHeaderFor(buyer));

    expect(body.reviewId).toBeNull();
  });

  it("reports the review's id once one exists", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const order = await makeOrder({ buyerId: buyer.id, status: "completed" });
    const review = await makeReview({ orderId: order.id, reviewerId: buyer.id });

    const { body } = await read(order.id, authHeaderFor(buyer));

    expect(body.reviewId).toBe(review.id);
  });
});
