/**
 * Part 3 spec §5.4 — the scheduled sweep.
 *
 * Same shape as `prune-tokens.integration.test.ts`: the function is the unit, the script
 * wrapper is not, and the cutoff is Postgres's rather than Node's.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { expireReservations } from "@/db/expire-reservations";
import { listings, orders } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder } from "@/test/factories";

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb();
});

async function statusOf(listingId: number): Promise<string> {
  const db = await getTestDb();
  const [row] = await db
    .select({ status: listings.status })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  return row.status;
}

describe("expireReservations", () => {
  it("expires a lapsed order and returns its listing to browse", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });
    const order = await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() - HOUR),
    });

    const result = await expireReservations();

    expect(result).toEqual({ expiredOrders: 1, releasedListings: 1 });

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("expired");
    expect(await statusOf(listing.id)).toBe("active");
  });

  it("leaves a live reservation alone", async () => {
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() + HOUR),
    });

    expect(await expireReservations()).toEqual({ expiredOrders: 0, releasedListings: 0 });
    expect(await statusOf(listing.id)).toBe("reserved");
  });

  it("releases a listing left reserved by an order that is already terminal", async () => {
    // The state a deleted or hand-edited order leaves behind. The sweep is what notices.
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({ listingId: listing.id, status: "cancelled" });

    const result = await expireReservations();

    expect(result).toEqual({ expiredOrders: 0, releasedListings: 1 });
    expect(await statusOf(listing.id)).toBe("active");
  });

  it("expires and releases across many listings in one pass", async () => {
    for (let i = 0; i < 3; i++) {
      const listing = await makeListing({ status: "reserved" });
      await makeOrder({
        listingId: listing.id,
        status: "pending",
        expiresAt: new Date(Date.now() - HOUR),
      });
    }

    expect(await expireReservations()).toEqual({ expiredOrders: 3, releasedListings: 3 });
  });

  it("is a no-op on a marketplace with nothing to sweep", async () => {
    await makeListing();
    expect(await expireReservations()).toEqual({ expiredOrders: 0, releasedListings: 0 });
  });

  it("changes nothing that a second run would change again", async () => {
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() - HOUR),
    });

    await expireReservations();
    const second = await expireReservations();

    expect(second).toEqual({ expiredOrders: 0, releasedListings: 0 });
  });

  it("runs the two steps in order, so a just-expired order releases its listing", async () => {
    // Releasing before expiring would find the order still `pending` and leave the
    // listing held until the next run — an hour of a listing nobody can buy.
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() - HOUR),
    });

    const result = await expireReservations();

    expect(result.releasedListings).toBe(1);
  });
});
