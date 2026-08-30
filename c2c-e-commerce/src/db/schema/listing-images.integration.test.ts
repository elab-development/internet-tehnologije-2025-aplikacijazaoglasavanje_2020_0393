/**
 * Part 2 spec — the listing_images table.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { listingImages, listings } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeListingImage } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

describe("listing_images", () => {
  it("stores an image against a listing", async () => {
    const listing = await makeListing();
    const image = await makeListingImage({ listingId: listing.id });

    expect(image.listingId).toBe(listing.id);
    expect(image.storageKey).toMatch(/^listings\/\d+\/[0-9a-f]{32}\.webp$/);
    expect(image.sortOrder).toBe(0);
  });

  it("cascades when its listing is deleted", async () => {
    const db = await getTestDb();
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id });

    await db.delete(listings).where(eq(listings.id, listing.id));

    const remaining = await db
      .select()
      .from(listingImages)
      .where(eq(listingImages.listingId, listing.id));

    expect(remaining).toHaveLength(0);
  });

  it("keeps images ordered by sortOrder", async () => {
    const db = await getTestDb();
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 2 });
    await makeListingImage({ listingId: listing.id, sortOrder: 0 });
    await makeListingImage({ listingId: listing.id, sortOrder: 1 });

    const rows = await db
      .select()
      .from(listingImages)
      .where(eq(listingImages.listingId, listing.id))
      .orderBy(listingImages.sortOrder);

    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe("listing status", () => {
  it("accepts draft", async () => {
    const listing = await makeListing({ status: "draft" });

    expect(listing.status).toBe("draft");
  });
});
