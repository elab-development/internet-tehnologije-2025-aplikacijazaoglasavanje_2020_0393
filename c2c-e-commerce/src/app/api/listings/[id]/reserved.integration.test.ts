/**
 * Part 3 — what `reserved` means to the listing routes.
 *
 * A reservation nobody but the order lifecycle can clear is the only kind worth having:
 * if the seller can press Disable while a buyer waits, the 409 the buyer got is a
 * promise the marketplace does not keep.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { listings } from "@/db/schema";
import { getStorageProvider } from "@/lib/storage";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeListingImage, makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function readListing(id: number, headers: Record<string, string> = {}) {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/listings/${id}`, { headers }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status };
}

async function editListing(id: number, headers: Record<string, string>, body: unknown) {
  const { PATCH } = await import("./route");
  const response = await PATCH(
    new NextRequest(`http://localhost/api/listings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status };
}

async function readImage(id: number, headers: Record<string, string> = {}) {
  const { GET } = await import("../../images/[id]/route");
  const response = await GET(
    new NextRequest(`http://localhost/api/images/${id}`, { headers }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status };
}

describe("a reserved or sold listing is still public", () => {
  it("serves the detail page to an anonymous visitor", async () => {
    for (const status of ["reserved", "sold"] as const) {
      const listing = await makeListing({ status });
      expect((await readListing(listing.id)).status, status).toBe(200);
    }
  });

  it("still hides drafts and removed listings from strangers", async () => {
    for (const status of ["draft", "removed"] as const) {
      const listing = await makeListing({ status });
      expect((await readListing(listing.id)).status, status).toBe(404);
    }
  });

  it("still shows a draft to its own seller", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "draft" });

    expect((await readListing(listing.id, authHeaderFor(seller))).status).toBe(200);
  });
});

describe("a reserved listing's photos stay served", () => {
  it("serves an image on a reserved listing to an anonymous visitor", async () => {
    // The buyer holding the reservation has to be able to look at what they claimed.
    const listing = await makeListing({ status: "reserved" });
    const image = await storedImageOn(listing.id);

    expect((await readImage(image.id)).status).toBe(200);
  });

  it("still refuses an image on a draft listing", async () => {
    const listing = await makeListing({ status: "draft" });
    const image = await storedImageOn(listing.id);

    expect((await readImage(image.id)).status).toBe(404);
  });
});

/**
 * `makeListingImage` inserts a row and puts nothing in storage, so a row alone answers
 * 404 from the "the object has vanished" branch — the same status as the visibility
 * refusal, which would make both cases above assert nothing. This helper puts real bytes
 * through the configured provider (the memory driver under `NODE_ENV=test`) and hangs
 * the row off the key it returns.
 *
 * The provider generates the key, which is why the row is created second. The bytes are
 * never decoded on the way out — `GET /api/images/{id}` serves what it stored — so they
 * do not have to be a real WebP.
 */
async function storedImageOn(listingId: number) {
  const stored = await getStorageProvider().put(Buffer.from("not really a webp"), {
    contentType: "image/webp",
    prefix: `listings/${listingId}`,
  });

  return makeListingImage({
    listingId,
    storageKey: stored.key,
    contentType: stored.contentType,
    byteSize: stored.byteSize,
  });
}

describe("a reserved listing cannot be re-statused by its seller", () => {
  it("refuses the seller's status change with 409", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "reserved" });

    const { status } = await editListing(listing.id, authHeaderFor(seller), {
      status: "removed",
    });

    expect(status).toBe(409);

    const db = await getTestDb();
    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.status).toBe("reserved");
  });

  it("still lets the seller edit everything else", async () => {
    // The order captured its own price, so an edit cannot change what the buyer owes.
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "reserved" });

    const { status } = await editListing(listing.id, authHeaderFor(seller), {
      title: "Road bike, barely used",
    });

    expect(status).toBe(200);
  });

  it("lets an admin change it anyway", async () => {
    const admin = await makeUser({ role: "admin" });
    const listing = await makeListing({ status: "reserved" });

    const { status } = await editListing(listing.id, authHeaderFor(admin), {
      status: "removed",
    });

    expect(status).toBe(200);
  });

  it("leaves an active listing's status editable", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "active" });

    const { status } = await editListing(listing.id, authHeaderFor(seller), {
      status: "removed",
    });

    expect(status).toBe(200);
  });
});

describe("a sold listing still held by a live order cannot be re-statused by its seller", () => {
  it("refuses the seller's status change with 409 while a confirmed order holds it", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    await makeOrder({ listingId: listing.id, sellerId: seller.id, status: "confirmed" });

    const { status } = await editListing(listing.id, authHeaderFor(seller), {
      status: "active",
    });

    expect(status).toBe(409);

    const db = await getTestDb();
    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.status).toBe("sold");
  });

  it("refuses the seller's status change with 409 while a shipped order holds it", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    await makeOrder({ listingId: listing.id, sellerId: seller.id, status: "shipped" });

    const { status } = await editListing(listing.id, authHeaderFor(seller), {
      status: "active",
    });

    expect(status).toBe(409);

    const db = await getTestDb();
    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.status).toBe("sold");
  });

  it("lets the seller relist a sold listing whose only order is completed", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    await makeOrder({ listingId: listing.id, sellerId: seller.id, status: "completed" });

    const { status } = await editListing(listing.id, authHeaderFor(seller), {
      status: "active",
    });

    expect(status).toBe(200);
  });

  it("lets an admin relist a held sold listing anyway", async () => {
    const seller = await makeUser({ role: "seller" });
    const admin = await makeUser({ role: "admin" });
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    await makeOrder({ listingId: listing.id, sellerId: seller.id, status: "confirmed" });

    const { status } = await editListing(listing.id, authHeaderFor(admin), {
      status: "active",
    });

    expect(status).toBe(200);
  });
});
