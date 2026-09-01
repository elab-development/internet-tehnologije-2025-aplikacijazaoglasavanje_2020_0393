/**
 * Part 3 spec §5.2 and §5.4 — the statements reservation is made of.
 *
 * Each is tested on its own here, so a failure in the route's transaction points at the
 * route rather than at the SQL underneath it.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyListingSideEffect,
  claimListing,
  expireStalePendingOrders,
  releaseUnheldListings,
  transitionOrder,
} from "@/db/orders";
import * as schema from "@/db/schema";
import { listings, orders } from "@/db/schema";
import { getTestDb, resetDb, testPool } from "@/test/db";
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

  it("never resurrects a draft or removed listing", async () => {
    // The predicate is `status IN ('reserved', 'sold')`, not `NOT EXISTS(...)`. Without
    // the status clause this would republish every listing its seller had withdrawn.
    // `sold` is deliberately not tested here since task 15: an orphaned sold listing —
    // one with no live order at all — is exactly what this function is now meant to
    // release; see "releaseUnheldListings and sold listings" below for that case and its
    // guard.
    const db = await getTestDb();
    const draft = await makeListing({ status: "draft" });
    const removed = await makeListing({ status: "removed" });

    await releaseUnheldListings(db);

    expect(await statusOf(draft.id)).toBe("draft");
    expect(await statusOf(removed.id)).toBe("removed");
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
  it("sells a reserved listing, and says it changed one", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });

    expect(await applyListingSideEffect(db, listing.id, "sold")).toBe(1);

    expect(await statusOf(listing.id)).toBe("sold");
  });

  it("refuses to sell a listing that was never reserved, and says it changed none", async () => {
    // Reaching `sold` without passing through `reserved` would mean an order confirmed a
    // listing nobody had claimed. The count is how the caller finds out: a conditional
    // UPDATE that matches nothing looks exactly like one that worked.
    const db = await getTestDb();
    const listing = await makeListing({ status: "active" });

    expect(await applyListingSideEffect(db, listing.id, "sold")).toBe(0);

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

    expect(await applyListingSideEffect(db, draft.id, "active")).toBe(0);
    expect(await applyListingSideEffect(db, removed.id, "active")).toBe(0);

    expect(await statusOf(draft.id)).toBe("draft");
    expect(await statusOf(removed.id)).toBe("removed");
  });
});

describe("transitionOrder", () => {
  it("moves an order from the status it was decided against", async () => {
    const db = await getTestDb();
    const order = await makeOrder({ status: "pending" });

    const moved = await transitionOrder(db, order.id, "pending", "confirmed");

    expect(moved?.status).toBe("confirmed");
  });

  it("returns null when the order has already moved", async () => {
    const db = await getTestDb();
    const order = await makeOrder({ status: "confirmed" });

    // The caller decided against `pending`; somebody else got there first.
    expect(await transitionOrder(db, order.id, "pending", "cancelled")).toBeNull();
  });

  it("returns null for an order that does not exist", async () => {
    const db = await getTestDb();
    expect(await transitionOrder(db, 999_999, "pending", "cancelled")).toBeNull();
  });

  it("lets exactly one of two overlapping transactions move the same order", async () => {
    // Two transactions held open at once, which is what a route cannot arrange from the
    // outside: the second one's UPDATE blocks on the first's row lock, then re-evaluates
    // its WHERE against the committed row and matches nothing.
    //
    // A dedicated pool, because the shared one is what `resetDb` and the factories use —
    // holding two of its connections open across a lock wait would starve them.
    const order = await makeOrder({ status: "pending" });

    const pool = await testPool();
    const a = await pool.connect();
    const b = await pool.connect();

    try {
      // Drizzle binds to a single checked-out connection as happily as to a pool, so both
      // sides run the real `transitionOrder` rather than a copy of its statement.
      const dbA = drizzle(a, { schema });
      const dbB = drizzle(b, { schema });

      await a.query("BEGIN");
      await b.query("BEGIN");

      const movedA = await transitionOrder(dbA, order.id, "pending", "confirmed");

      // Deliberately not awaited yet: B's UPDATE has to reach the server and block on A's
      // row lock while A is still open, which is the interleaving under test.
      const bResult = transitionOrder(dbB, order.id, "pending", "cancelled");
      // The delay isn't what makes this deterministic -- it just makes it likely that B's
      // UPDATE is already queued on A's row lock by the time A commits. Either way the
      // result is the same: transitionOrder's WHERE re-checks `status = from`, so a B that
      // was queued wakes up, re-evaluates against the now-confirmed row and matches nothing;
      // a B that (were this shorter) instead reached the server after the commit would just
      // see that same committed row directly and match nothing anyway. Postgres serialises
      // the outcome regardless of real-time interleaving, which is what makes this a
      // lock-forced test rather than a lucky `Promise.all`.
      await new Promise((resolve) => setTimeout(resolve, 250));

      await a.query("COMMIT");
      const movedB = await bResult;
      await b.query("COMMIT");

      expect([movedA, movedB].filter((row) => row !== null)).toHaveLength(1);
      expect(movedA?.status).toBe("confirmed");
      expect(movedB).toBeNull();
    } finally {
      a.release();
      b.release();
      await pool.end();
    }
  });
});

describe("releaseUnheldListings and sold listings", () => {
  async function seedConfirmedOrder() {
    const listing = await makeListing({ status: "sold" });
    const order = await makeOrder({ listingId: listing.id, status: "confirmed" });
    return { listing, order };
  }

  async function deleteOrder(orderId: number): Promise<void> {
    const db = await getTestDb();
    await db.delete(orders).where(eq(orders.id, orderId));
  }

  it("returns a sold listing to active when its order is deleted", async () => {
    // Only `reserved` was released, so deleting a confirmed order left the listing sold
    // forever: unbuyable, with no order left to explain why.
    const db = await getTestDb();
    const { listing, order } = await seedConfirmedOrder();
    expect(await statusOf(listing.id)).toBe("sold");

    await deleteOrder(order.id);
    await releaseUnheldListings(db, listing.id);

    expect(await statusOf(listing.id)).toBe("active");
  });

  it("leaves a sold listing alone while a live order still holds it", async () => {
    // The guard that keeps this from becoming "any sold listing goes back on sale".
    const db = await getTestDb();
    const { listing } = await seedConfirmedOrder();

    await releaseUnheldListings(db, listing.id);

    expect(await statusOf(listing.id)).toBe("sold");
  });

  it("leaves a sold listing alone once its order has shipped", async () => {
    // `listingStatusAfter("shipped")` is `null`: the listing has been `sold` since
    // confirmation and shipping says nothing new. A liveness test of `IN ('pending',
    // 'confirmed')` would miss this status and release the listing mid-sale.
    const db = await getTestDb();
    const listing = await makeListing({ status: "sold" });
    await makeOrder({ listingId: listing.id, status: "shipped" });

    await releaseUnheldListings(db, listing.id);

    expect(await statusOf(listing.id)).toBe("sold");
  });

  it("leaves a sold listing alone once its order has completed", async () => {
    // The case this task's own regression would have gotten wrong: a finished sale is
    // not an unheld one. Releasing it here would be the double-sell the 2026-08-30
    // redesign exists to make unrepresentable, reached by deleting a completed order.
    const db = await getTestDb();
    const listing = await makeListing({ status: "sold" });
    await makeOrder({ listingId: listing.id, status: "completed" });

    await releaseUnheldListings(db, listing.id);

    expect(await statusOf(listing.id)).toBe("sold");
  });
});
