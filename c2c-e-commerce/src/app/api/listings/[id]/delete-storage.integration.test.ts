/**
 * Migration 0012's ON DELETE CASCADE removes listing_images with the listing row, and
 * with them the only record of the objects' storage keys. Nothing calls
 * StorageProvider.delete for them, so deleting a listing used to leak every stored
 * object — the row was gone but the bytes stayed on disk forever, with no query able to
 * find them afterward.
 *
 * DELETE /api/listings/[id] now reads the image rows before deleting, then best-effort
 * deletes each object afterward, mirroring the image route's own delete handler.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { signToken } from "@/lib/auth";
import { getStorageProvider } from "@/lib/storage";
import { resetDb } from "@/test/db";
import { makeListing, makeUser } from "@/test/factories";

let sellerToken: string;
let sellerId: number;

beforeEach(async () => {
  await resetDb();
  const seller = await makeUser({ role: "seller" });
  sellerId = seller.id;
  sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
});

async function deleteListing(id: number) {
  const { DELETE } = await import("./route");
  return DELETE(
    new NextRequest(`http://localhost/api/listings/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sellerToken}` },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

describe("DELETE /api/listings/[id] — storage cleanup", () => {
  it("deletes the stored objects for every image on the listing", async () => {
    const listing = await makeListing({ sellerId });

    // Real objects in the provider, not just rows shaped like keys — the point is that
    // the *bytes* are gone afterward, and only a real put/get round trip proves that.
    const provider = getStorageProvider();
    const first = await provider.put(Buffer.from("one"), {
      contentType: "image/webp",
      prefix: `listings/${listing.id}`,
    });
    const second = await provider.put(Buffer.from("two"), {
      contentType: "image/webp",
      prefix: `listings/${listing.id}`,
    });

    const { insertImage } = await import("@/db/listing-images");
    await insertImage({
      listingId: listing.id,
      storageKey: first.key,
      contentType: first.contentType,
      byteSize: first.byteSize,
      width: 10,
      height: 10,
      sortOrder: 0,
    });
    await insertImage({
      listingId: listing.id,
      storageKey: second.key,
      contentType: second.contentType,
      byteSize: second.byteSize,
      width: 10,
      height: 10,
      sortOrder: 1,
    });

    expect(await provider.get(first.key)).not.toBeNull();
    expect(await provider.get(second.key)).not.toBeNull();

    const response = await deleteListing(listing.id);
    expect(response.status).toBe(200);

    expect(await provider.get(first.key)).toBeNull();
    expect(await provider.get(second.key)).toBeNull();
  });

  it("succeeds for a listing with no images", async () => {
    const listing = await makeListing({ sellerId });

    const response = await deleteListing(listing.id);

    expect(response.status).toBe(200);
  });
});
