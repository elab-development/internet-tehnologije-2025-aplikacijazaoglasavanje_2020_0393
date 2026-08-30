/**
 * Part 3 spec §5.2 and §5.4 — the statements reservation is made of.
 *
 * Each is tested on its own here, so a failure in the route's transaction points at the
 * route rather than at the SQL underneath it.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyListingSideEffect,
  claimListing,
  expireStalePendingOrders,
  releaseUnheldListings,
} from "@/db/orders";
import { listings, orders } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

const HOUR = 60 * 60 * 1000;
const past = (hours: number) => new Date(Date.now() - hours * HOUR);
const future = (hours: number) => new Date(Date.now() + hours * HOUR);

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

describe("expireStalePendingOrders", () => {
  it("expires a pending order past its deadline", async () => {
    const db = await getTestDb();
    const order = await makeOrder({ status: "pending", expiresAt: past(1) });

    const count = await expireStalePendingOrders(db);

    expect(count).toBe(1);
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("expired");
  });

  it("leaves a pending order inside its deadline alone", async () => {
    const db = await getTestDb();
    const order = await makeOrder({ status: "pending", expiresAt: future(1) });

    expect(await expireStalePendingOrders(db)).toBe(0);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("pending");
  });

  it("never touches an order that is not pending, however old", async () => {
    // A confirmed order's deadline is meaningless — the seller already answered. Sweeping
    // it would cancel a live sale.
    const db = await getTestDb();
    const order = await makeOrder({ status: "confirmed", expiresAt: past(500) });

    expect(await expireStalePendingOrders(db)).toBe(0);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("confirmed");
  });

  it("scopes to one listing when given one", async () => {
    const db = await getTestDb();
    const mine = await makeListing();
    const theirs = await makeListing();
    await makeOrder({ listingId: mine.id, status: "pending", expiresAt: past(1) });
    const other = await makeOrder({
      listingId: theirs.id,
      status: "pending",
      expiresAt: past(1),
    });

    expect(await expireStalePendingOrders(db, mine.id)).toBe(1);

    const [row] = await db.select().from(orders).where(eq(orders.id, other.id));
    expect(row.status).toBe("pending");
  });
});

describe("releaseUnheldListings", () => {
  it("returns a reserved listing to browse when nothing pending holds it", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({ listingId: listing.id, status: "expired", expiresAt: past(1) });

    expect(await releaseUnheldListings(db)).toBe(1);
    expect(await statusOf(listing.id)).toBe("active");
  });

  it("leaves a reserved listing alone while a pending order holds it", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({ listingId: listing.id, status: "pending", expiresAt: future(1) });

    expect(await releaseUnheldListings(db)).toBe(0);
    expect(await statusOf(listing.id)).toBe("reserved");
  });

  it("never resurrects a draft, removed or sold listing", async () => {
    // The predicate is `status = 'reserved'`, not `NOT EXISTS(...)`. Without the status
    // clause this would republish every listing its seller had withdrawn.
    const db = await getTestDb();
    const draft = await makeListing({ status: "draft" });
    const removed = await makeListing({ status: "removed" });
    const sold = await makeListing({ status: "sold" });

    await releaseUnheldListings(db);

    expect(await statusOf(draft.id)).toBe("draft");
    expect(await statusOf(removed.id)).toBe("removed");
    expect(await statusOf(sold.id)).toBe("sold");
  });

  it("scopes to one listing when given one", async () => {
    const db = await getTestDb();
    const mine = await makeListing({ status: "reserved" });
    const theirs = await makeListing({ status: "reserved" });

    expect(await releaseUnheldListings(db, mine.id)).toBe(1);

    expect(await statusOf(mine.id)).toBe("active");
    expect(await statusOf(theirs.id)).toBe("reserved");
  });
});

describe("claimListing", () => {
  it("reserves an active listing and returns its price and seller", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, price: "123.45" });

    const claimed = await claimListing(db, listing.id);

    expect(claimed).toEqual({ id: listing.id, price: "123.45", sellerId: seller.id });
    expect(await statusOf(listing.id)).toBe("reserved");
  });

  it("returns null for a listing that is already reserved", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });

    expect(await claimListing(db, listing.id)).toBeNull();
  });

  it("returns null for a sold, draft or removed listing", async () => {
    const db = await getTestDb();

    for (const status of ["sold", "draft", "removed"] as const) {
      const listing = await makeListing({ status });
      expect(await claimListing(db, listing.id), status).toBeNull();
      expect(await statusOf(listing.id)).toBe(status);
    }
  });

  it("returns null for a listing that does not exist", async () => {
    const db = await getTestDb();
    expect(await claimListing(db, 999_999)).toBeNull();
  });

  it("lets exactly one of two concurrent claims win", async () => {
    // The whole point of the conditional UPDATE. A lock would serialise these and let
    // both succeed in turn; the WHERE clause makes the second one match nothing.
    const db = await getTestDb();
    const listing = await makeListing();

    const [a, b] = await Promise.all([
      claimListing(db, listing.id),
      claimListing(db, listing.id),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("does not bump the listing's updated_at", async () => {
    // `updated_at` drives the embedding backfill's staleness query. A reservation says
    // nothing about the listing's text, and marking it stale would re-embed every
    // listing anybody ever clicked Buy on.
    const db = await getTestDb();
    const listing = await makeListing();

    await claimListing(db, listing.id);

    const [row] = await db
      .select({ updatedAt: listings.updatedAt })
      .from(listings)
      .where(eq(listings.id, listing.id));

    expect(row.updatedAt.getTime()).toBe(listing.updatedAt.getTime());
  });
});

describe("applyListingSideEffect", () => {
  it("sells a reserved listing", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });

    await applyListingSideEffect(db, listing.id, "sold");

    expect(await statusOf(listing.id)).toBe("sold");
  });

  it("refuses to sell a listing that was never reserved", async () => {
    // Reaching `sold` without passing through `reserved` would mean an order confirmed a
    // listing nobody had claimed.
    const db = await getTestDb();
    const listing = await makeListing({ status: "active" });

    await applyListingSideEffect(db, listing.id, "sold");

    expect(await statusOf(listing.id)).toBe("active");
  });

  it("returns a reserved listing to browse", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });

    await applyListingSideEffect(db, listing.id, "active");

    expect(await statusOf(listing.id)).toBe("active");
  });

  it("returns a sold listing to browse, for a cancellation after confirmation", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "sold" });

    await applyListingSideEffect(db, listing.id, "active");

    expect(await statusOf(listing.id)).toBe("active");
  });

  it("never republishes a draft or removed listing", async () => {
    const db = await getTestDb();
    const draft = await makeListing({ status: "draft" });
    const removed = await makeListing({ status: "removed" });

    await applyListingSideEffect(db, draft.id, "active");
    await applyListingSideEffect(db, removed.id, "active");

    expect(await statusOf(draft.id)).toBe("draft");
    expect(await statusOf(removed.id)).toBe("removed");
  });
});
