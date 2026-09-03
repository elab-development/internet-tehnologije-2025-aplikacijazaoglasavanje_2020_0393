/**
 * `orders.listing_id` is RESTRICT, so deleting a listing that any order references used
 * to hit the constraint and surface as an opaque 500 -- one cancelled order was enough to
 * make a listing permanently undeletable.
 *
 * Withdrawing it instead is what the seller wanted anyway: `removed` is outside
 * PUBLIC_LISTING_STATUSES, so the listing leaves every public read path while the buyer's
 * order keeps pointing at something real.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { DELETE, GET } from "@/app/api/listings/[id]/route";
import { db } from "@/db";
import { claimListing, reservationDeadline } from "@/db/orders";
import { insertImage } from "@/db/listing-images";
import * as schema from "@/db/schema";
import { listingImages, listings, orders } from "@/db/schema";
import { signToken } from "@/lib/auth";
import { getStorageProvider } from "@/lib/storage";
import { resetDb, testPool } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

function authed(token: string, id: number): NextRequest {
  return new NextRequest(`http://localhost/api/listings/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * A listing with a cancelled order against it -- terminal, so the seller is free to act
 * on the listing again, but the order row still exists and still points at it.
 */
async function seedListingWithCancelledOrder(options: { images?: number } = {}) {
  const seller = await makeUser({ role: "seller" });
  const sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
  const listing = await makeListing({ sellerId: seller.id });
  await makeOrder({ listingId: listing.id, sellerId: seller.id, status: "cancelled" });

  for (let i = 0; i < (options.images ?? 0); i++) {
    await insertImage({
      listingId: listing.id,
      storageKey: `listings/${listing.id}/${i.toString(16).padStart(32, "0")}.webp`,
      contentType: "image/webp",
      byteSize: 1024,
      width: 800,
      height: 600,
      sortOrder: i,
    });
  }

  return { listing, sellerToken };
}

/** A listing with no order history at all -- the case that must still hard-delete. */
async function seedListingWithoutOrders(options: { images?: number } = {}) {
  const seller = await makeUser({ role: "seller" });
  const sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
  const listing = await makeListing({ sellerId: seller.id });

  const provider = getStorageProvider();
  const storageKeys: string[] = [];
  for (let i = 0; i < (options.images ?? 0); i++) {
    const object = await provider.put(Buffer.from(`image-${i}`), {
      contentType: "image/webp",
      prefix: `listings/${listing.id}`,
    });
    await insertImage({
      listingId: listing.id,
      storageKey: object.key,
      contentType: object.contentType,
      byteSize: object.byteSize,
      width: 800,
      height: 600,
      sortOrder: i,
    });
    storageKeys.push(object.key);
  }

  return { listing, sellerToken, storageKeys };
}

describe("DELETE /api/listings/[id] with order history", () => {
  it("withdraws rather than deletes when an order references the listing", async () => {
    const { listing, sellerToken } = await seedListingWithCancelledOrder();

    const response = await DELETE(authed(sellerToken, listing.id), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(200);

    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row).toBeDefined();
    expect(row.status).toBe("removed");
  });

  it("keeps the images of a withdrawn listing", async () => {
    // The listing row still exists and the buyer's order still links to it, so cleaning
    // up its objects would leave the order pointing at a listing with no photos.
    const { listing, sellerToken } = await seedListingWithCancelledOrder({ images: 2 });

    await DELETE(authed(sellerToken, listing.id), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    const images = await db
      .select()
      .from(listingImages)
      .where(eq(listingImages.listingId, listing.id));
    expect(images).toHaveLength(2);
  });

  it("hides a withdrawn listing from the public detail route", async () => {
    const { listing, sellerToken } = await seedListingWithCancelledOrder();

    await DELETE(authed(sellerToken, listing.id), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    const anonymous = await GET(new NextRequest(`http://test/api/listings/${listing.id}`), {
      params: Promise.resolve({ id: String(listing.id) }),
    });
    expect(anonymous.status).toBe(404);
  });

  it("still hard-deletes a listing no order references", async () => {
    // The positive control. Without it, a handler that withdrew *everything* would pass
    // every assertion above while quietly abandoning real deletion.
    const { listing, sellerToken } = await seedListingWithoutOrders();

    const response = await DELETE(authed(sellerToken, listing.id), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(200);
    expect(await db.select().from(listings).where(eq(listings.id, listing.id))).toHaveLength(0);
  });

  it("removes the storage objects of a hard-deleted listing", async () => {
    const { listing, sellerToken, storageKeys } = await seedListingWithoutOrders({ images: 2 });

    await DELETE(authed(sellerToken, listing.id), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    for (const key of storageKeys) {
      expect(await getStorageProvider().get(key)).toBeNull();
    }
  });
});

describe("DELETE /api/listings/[id] races a concurrent reservation", () => {
  it("withdraws rather than 500s when a claim is still open under its lock", async () => {
    // Two transactions held open at once, the same technique
    // src/db/orders.integration.test.ts already uses to prove `transitionOrder`'s row
    // lock serialises two overlapping updates: a dedicated pool, because the shared one
    // is what `resetDb` and the factories use, and holding a connection open across a
    // lock wait would starve them.
    //
    // Connection A plays the claim that used to make this listing undeletable: it takes
    // `claimListing`'s row lock (the same function POST /api/orders calls) and inserts
    // the order that references the listing, then stays open -- uncommitted -- while the
    // real DELETE handler runs concurrently on the shared pool.
    //
    // Before this task's lock fix, DELETE's unlocked `SELECT` read past A's still-open
    // claim (READ COMMITTED sees only what's committed, and nothing was yet), decided
    // there was no referencing order, and its `db.delete(listings)` then had to wait for
    // A's row lock exactly as here -- only to wake up and hit RESTRICT against the order
    // A had by then committed, surfacing as the opaque 500. With the fix, it's DELETE's
    // own `SELECT ... FOR UPDATE` that blocks, and the referencing-order check re-runs
    // after A commits and finds the order -- so it withdraws instead. The assertions
    // below hold no matter how the two happen to interleave in real time, which is what
    // makes this deterministic rather than a lucky `Promise.all`: A's transaction is
    // provably still open when DELETE is invoked, and Postgres serialises whatever
    // happens next.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
    const listing = await makeListing({ sellerId: seller.id, status: "active" });

    const pool = await testPool();
    const a = await pool.connect();

    try {
      const dbA = drizzle(a, { schema });

      await a.query("BEGIN");
      const claimed = await claimListing(dbA, listing.id);
      if (!claimed) throw new Error("test setup: claiming a fresh active listing must succeed");

      await dbA.insert(orders).values({
        buyerId: buyer.id,
        sellerId: claimed.sellerId,
        listingId: claimed.id,
        price: claimed.price,
        expiresAt: reservationDeadline(),
      });

      // Deliberately not awaited yet: DELETE's row lock has to reach the server and
      // block on A's still-open lock, which is the interleaving under test.
      const delPromise = DELETE(authed(sellerToken, listing.id), {
        params: Promise.resolve({ id: String(listing.id) }),
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      await a.query("COMMIT");
      const delRes = await delPromise;

      expect(delRes.status).toBe(200);
      const delBody = await delRes.json();
      expect(delBody.status).toBe("removed");

      const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
      expect(row?.status).toBe("removed");
    } finally {
      a.release();
      await pool.end();
    }
  });
});
