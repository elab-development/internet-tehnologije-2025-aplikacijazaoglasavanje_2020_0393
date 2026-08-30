/**
 * Part 3 spec §5.5 — the seller dashboard is a column filter now.
 */
import { inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { orders } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

type Row = {
  id: number;
  sellerId: number;
  listingTitle: string;
  buyerName: string;
  buyerEmail: string;
  price: string;
  status: string;
  coverImageId: number | null;
};

async function sales(headers: Record<string, string> = {}) {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest("http://localhost/api/orders/seller", { headers }),
  );
  return { status: response.status, body: (await response.json()) as Row[] };
}

describe("GET /api/orders/seller", () => {
  it("returns the caller's own sales, with the buyer and the listing joined in", async () => {
    const seller = await makeUser({ role: "seller", name: "Sam" });
    const buyer = await makeUser({ role: "buyer", name: "Bea", email: "bea@example.test" });
    const listing = await makeListing({ sellerId: seller.id, title: "Road bike", price: "500.00" });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      listingId: listing.id,
      status: "pending",
    });

    const { status, body } = await sales(authHeaderFor(seller));

    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: order.id,
      listingTitle: "Road bike",
      buyerName: "Bea",
      buyerEmail: "bea@example.test",
      price: "500.00",
      status: "pending",
    });
  });

  it("excludes another seller's sales", async () => {
    const mine = await makeUser({ role: "seller" });
    const theirs = await makeUser({ role: "seller" });
    const own = await makeOrder({ sellerId: mine.id });
    await makeOrder({ sellerId: theirs.id });

    const { body } = await sales(authHeaderFor(mine));

    expect(body.map((o) => o.id)).toEqual([own.id]);
  });

  it("excludes the seller's own purchases", async () => {
    // A seller who buys something sees it under /api/orders, not here. This endpoint
    // answers "what am I selling".
    const seller = await makeUser({ role: "seller" });
    await makeOrder({ buyerId: seller.id });

    const { body } = await sales(authHeaderFor(seller));

    expect(body).toHaveLength(0);
  });

  it("returns an empty array for a seller with no sales", async () => {
    const seller = await makeUser({ role: "seller" });
    const { status, body } = await sales(authHeaderFor(seller));

    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("returns every sale to an admin", async () => {
    const admin = await makeUser({ role: "admin" });
    await makeOrder();
    await makeOrder();

    const { body } = await sales(authHeaderFor(admin));

    expect(body).toHaveLength(2);
  });

  it("sorts newest first, deterministically", async () => {
    // Two orders placed in the same millisecond share a `created_at`, so `id` breaks the
    // tie. Without it this assertion would pass or fail depending on the planner.
    //
    // The tie has to be forced. Two sequential factory calls get `created_at` values
    // microseconds apart, which `created_at DESC` alone already orders correctly — so
    // this case passed without exercising the tiebreak at all until the update below.
    // `makeOrder` takes no `createdAt`, deliberately: nothing in production chooses one.
    const seller = await makeUser({ role: "seller" });
    const first = await makeOrder({ sellerId: seller.id });
    const second = await makeOrder({ sellerId: seller.id });

    const db = await getTestDb();
    const sameInstant = new Date("2026-08-30T12:00:00.000Z");
    await db
      .update(orders)
      .set({ createdAt: sameInstant })
      .where(inArray(orders.id, [first.id, second.id]));

    const { body } = await sales(authHeaderFor(seller));

    expect(body.map((o) => o.id)).toEqual([second.id, first.id]);
  });

  it("answers 401 unauthenticated and 403 to a buyer", async () => {
    const buyer = await makeUser({ role: "buyer" });

    expect((await sales()).status).toBe(401);
    expect((await sales(authHeaderFor(buyer))).status).toBe(403);
  });
});
