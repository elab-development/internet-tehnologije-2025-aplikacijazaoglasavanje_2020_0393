/**
 * Part 2 spec — uploading, reordering and deleting a listing's photos.
 *
 * Storage runs on the memory driver here (STORAGE_DRIVER defaults to memory under
 * NODE_ENV=test), so these tests exercise the real route and the real re-encoder without
 * touching a filesystem.
 */
import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

import { listImagesFor } from "@/db/listing-images";
import { signToken } from "@/lib/auth";
import { resetRateLimits } from "@/lib/rate-limit";
import { __resetStorageProvider } from "@/lib/storage";
import { resetDb } from "@/test/db";
import { makeListing, makeListingImage, makeUser } from "@/test/factories";

let clientCounter = 0;
const nextIp = () => `10.7.0.${(clientCounter += 1) % 250}`;

/** A real 4x4 PNG — sharp must be able to decode whatever we claim is an image. */
async function pngBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

function uploadRequest(listingId: number, token: string, file: Blob, filename = "photo.png") {
  const body = new FormData();
  body.set("file", file, filename);

  return new NextRequest(`http://localhost/api/listings/${listingId}/images`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-forwarded-for": nextIp() },
    body,
  });
}

async function upload(listingId: number, token: string, bytes: Buffer, filename?: string) {
  const { POST } = await import("./route");
  // Buffer's `.buffer` types as ArrayBufferLike (it may back onto a SharedArrayBuffer),
  // which BlobPart does not accept; a plain Uint8Array copy satisfies the type.
  const file = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  return POST(uploadRequest(listingId, token, file, filename), {
    params: Promise.resolve({ id: String(listingId) }),
  });
}

let sellerToken: string;
let sellerId: number;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  __resetStorageProvider();
  const seller = await makeUser({ role: "seller" });
  sellerId = seller.id;
  sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
});

describe("POST /api/listings/[id]/images", () => {
  it("stores an image and returns it", async () => {
    const listing = await makeListing({ sellerId });

    const response = await upload(listing.id, sellerToken, await pngBytes());
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created.width).toBe(4);
    expect(created.height).toBe(4);
    expect(created.sortOrder).toBe(0);

    // The response is a summary. The storage key is an internal address and must not
    // appear in it, so the re-encode is confirmed against the row instead.
    expect(created.storageKey).toBeUndefined();
    expect(created.listingId).toBeUndefined();

    const [stored] = await listImagesFor(listing.id);
    expect(stored.contentType).toBe("image/webp"); // re-encoded whatever came in (D10)
    expect(stored.storageKey).toMatch(/\.webp$/);
  });

  it("appends after existing images", async () => {
    const listing = await makeListing({ sellerId });
    await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    const response = await upload(listing.id, sellerToken, await pngBytes());

    expect((await response.json()).sortOrder).toBe(1);
  });

  it("rejects a file whose bytes are not an image, whatever it claims", async () => {
    const listing = await makeListing({ sellerId });

    const response = await upload(listing.id, sellerToken, Buffer.from("<html>nope</html>"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "That file is not a JPEG, PNG or WebP image",
    });
  });

  it("rejects a file over the size limit", async () => {
    const listing = await makeListing({ sellerId });
    const huge = Buffer.alloc(5 * 1024 * 1024 + 1);
    // Give it a real PNG header so the rejection is the size check, not the sniffer.
    (await pngBytes()).copy(huge, 0);

    const response = await upload(listing.id, sellerToken, huge);

    expect(response.status).toBe(413);
  });

  it("rejects the ninth image", async () => {
    const listing = await makeListing({ sellerId });
    for (let i = 0; i < 8; i++) {
      await makeListingImage({ listingId: listing.id, sortOrder: i });
    }

    const response = await upload(listing.id, sellerToken, await pngBytes());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "A listing may have at most 8 images",
    });
  });

  it("refuses a listing the caller does not own", async () => {
    const otherSeller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: otherSeller.id });

    const response = await upload(listing.id, sellerToken, await pngBytes());

    expect(response.status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    const listing = await makeListing({ sellerId });
    const { POST } = await import("./route");

    const body = new FormData();
    body.set("file", new Blob([new Uint8Array(await pngBytes())], { type: "image/png" }), "p.png");
    const response = await POST(
      new NextRequest(`http://localhost/api/listings/${listing.id}/images`, {
        method: "POST",
        headers: { "x-forwarded-for": nextIp() },
        body,
      }),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );

    expect(response.status).toBe(401);
  });

  it("never lets the client's filename reach the storage key", async () => {
    const listing = await makeListing({ sellerId });

    const response = await upload(
      listing.id,
      sellerToken,
      await pngBytes(),
      "../../etc/passwd.png",
    );

    expect(response.status).toBe(201);

    // Checked against the row, since the key never appears in the response.
    const [stored] = await listImagesFor(listing.id);
    expect(stored.storageKey).not.toContain("passwd");
    expect(stored.storageKey).not.toContain("..");
    expect(stored.storageKey).toMatch(/^listings\/\d+\/[0-9a-f]{32}\.webp$/);
  });

  it("refuses a GIF, which decodes fine but is outside the accepted list", async () => {
    const listing = await makeListing({ sellerId });
    const gif = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .gif()
      .toBuffer();

    const response = await upload(listing.id, sellerToken, gif);

    // sharp can decode this without complaint, so a 400 here can only come from the
    // sniffer's accepted-format check, not the re-encode branch.
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "That file is not a JPEG, PNG or WebP image",
    });
  });
});

describe("PATCH /api/listings/[id]/images", () => {
  it("reorders", async () => {
    const listing = await makeListing({ sellerId });
    const a = await makeListingImage({ listingId: listing.id, sortOrder: 0 });
    const b = await makeListingImage({ listingId: listing.id, sortOrder: 1 });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest(`http://localhost/api/listings/${listing.id}/images`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${sellerToken}`,
          "content-type": "application/json",
          "x-forwarded-for": nextIp(),
        },
        body: JSON.stringify({ order: [b.id, a.id] }),
      }),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );

    expect(response.status).toBe(200);
    expect((await listImagesFor(listing.id)).map((i) => i.id)).toEqual([b.id, a.id]);
  });
});

describe("DELETE /api/listings/[id]/images/[imageId]", () => {
  it("removes the row", async () => {
    const listing = await makeListing({ sellerId });
    const image = await makeListingImage({ listingId: listing.id });

    const { DELETE } = await import("./[imageId]/route");
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/listings/${listing.id}/images/${image.id}`,
        { method: "DELETE", headers: { authorization: `Bearer ${sellerToken}` } },
      ),
      { params: Promise.resolve({ id: String(listing.id), imageId: String(image.id) }) },
    );

    expect(response.status).toBe(200);
    expect(await listImagesFor(listing.id)).toHaveLength(0);
  });

  it("refuses an image on someone else's listing", async () => {
    const otherSeller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: otherSeller.id });
    const image = await makeListingImage({ listingId: listing.id });

    const { DELETE } = await import("./[imageId]/route");
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/listings/${listing.id}/images/${image.id}`,
        { method: "DELETE", headers: { authorization: `Bearer ${sellerToken}` } },
      ),
      { params: Promise.resolve({ id: String(listing.id), imageId: String(image.id) }) },
    );

    expect(response.status).toBe(403);
  });

  it("refuses an image that belongs to a different listing than the one in the path", async () => {
    // The caller owns `listing` (so canMutateListing passes) but the image named in the
    // path belongs to `victimListing`, which someone else owns. Without the listingId
    // scoping in the route, an owner of one listing could delete any image by naming
    // their own listing in the path and any image id in the URL.
    const listing = await makeListing({ sellerId });
    const victimSeller = await makeUser({ role: "seller" });
    const victimListing = await makeListing({ sellerId: victimSeller.id });
    const victimImage = await makeListingImage({ listingId: victimListing.id });

    const { DELETE } = await import("./[imageId]/route");
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/listings/${listing.id}/images/${victimImage.id}`,
        { method: "DELETE", headers: { authorization: `Bearer ${sellerToken}` } },
      ),
      { params: Promise.resolve({ id: String(listing.id), imageId: String(victimImage.id) }) },
    );

    expect(response.status).toBe(404);
    const stillThere = await listImagesFor(victimListing.id);
    expect(stillThere.map((i) => i.id)).toContain(victimImage.id);
  });
});
