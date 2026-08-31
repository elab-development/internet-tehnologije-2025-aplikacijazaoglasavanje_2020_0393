/**
 * D4 of the redesign spec says correctness must not depend on the sweep having run. It
 * did: `expires_at` was in no comparison on the transition path, so whether a lapsed
 * reservation could still be confirmed came down to timing.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { PUT } from "@/app/api/orders/[id]/route";
import { signToken } from "@/lib/auth";
import { resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR);

function authed(token: string, body: { status: string }): NextRequest {
  return new NextRequest("http://localhost/api/orders", {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** A pending order on a reserved listing, with a caller-chosen deadline. */
async function seedPendingOrder(options: { expiresAt: Date }) {
  const seller = await makeUser({ role: "seller" });
  const buyer = await makeUser({ role: "buyer" });
  const sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
  const listing = await makeListing({ sellerId: seller.id, status: "reserved" });
  const order = await makeOrder({
    buyerId: buyer.id,
    sellerId: seller.id,
    listingId: listing.id,
    status: "pending",
    expiresAt: options.expiresAt,
  });
  return { order, sellerToken };
}

describe("confirming a lapsed reservation", () => {
  it("is refused even though the sweep has not run", async () => {
    // Seeded already expired, and deliberately *without* invoking the expiry sweep.
    const { order, sellerToken } = await seedPendingOrder({ expiresAt: hoursAgo(1) });

    const response = await PUT(authed(sellerToken, { status: "confirmed" }), {
      params: Promise.resolve({ id: String(order.id) }),
    });

    expect(response.status).toBe(409);
  });

  it("still confirms an order inside its window", async () => {
    // Positive control: a guard that refused every confirmation would pass the assertion
    // above while breaking the seller's only way to accept a sale.
    const { order, sellerToken } = await seedPendingOrder({ expiresAt: hoursFromNow(24) });

    const response = await PUT(authed(sellerToken, { status: "confirmed" }), {
      params: Promise.resolve({ id: String(order.id) }),
    });

    expect(response.status).toBe(200);
  });

  it("still lets a lapsed order be declined or cancelled", async () => {
    // Expiry blocks the sale, not the tidy-up. Refusing every transition would strand the
    // order in a status nobody can leave.
    const { order, sellerToken } = await seedPendingOrder({ expiresAt: hoursAgo(1) });

    const response = await PUT(authed(sellerToken, { status: "declined" }), {
      params: Promise.resolve({ id: String(order.id) }),
    });

    expect(response.status).toBe(200);
  });
});
