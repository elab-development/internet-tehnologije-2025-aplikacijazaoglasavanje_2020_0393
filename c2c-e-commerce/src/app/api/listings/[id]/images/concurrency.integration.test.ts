/**
 * Three races, one lock. Concurrent uploads to one listing used to collide on sort_order
 * (making the cover image arbitrary) and to pass the count check together (exceeding the
 * cap). A body with no Content-Length used to skip the size gate entirely, because
 * Number(null) is 0 -- finite, and under any cap.
 */
import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

import { MAX_IMAGES_PER_LISTING, POST } from "@/app/api/listings/[id]/images/route";
import type { Listing } from "@/db/schema";
import { listImagesFor } from "@/db/listing-images";
import { signToken } from "@/lib/auth";
import { resetRateLimits } from "@/lib/rate-limit";
import { __resetStorageProvider } from "@/lib/storage";
import { resetDb } from "@/test/db";
import { makeListing, makeUser } from "@/test/factories";

let clientCounter = 0;
const nextIp = () => `10.7.1.${(clientCounter += 1) % 250}`;

/** A real 4x4 PNG -- sharp must be able to decode whatever we claim is an image. */
async function pngBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

async function seedSellerWithListing(): Promise<{ listing: Listing; token: string }> {
  const seller = await makeUser({ role: "seller" });
  const listing = await makeListing({ sellerId: seller.id });
  const token = signToken({ sub: seller.id, email: seller.email, role: seller.role });
  return { listing, token };
}

/**
 * Each call generates its own bytes and its own request -- no state shared across races.
 *
 * A real client's fetch() computes Content-Length while serialising a multipart body
 * before it ever reaches the wire; a NextRequest built in-process, as every test here
 * does, skips that step and leaves the header absent. Task 9's gate now requires it, so
 * it is computed and set explicitly -- via the same multipart encoder (Response) a
 * browser would otherwise apply invisibly -- rather than leaving these requests unable
 * to exercise the success path at all.
 */
async function upload(listingId: number, token: string) {
  const form = new FormData();
  // Buffer's `.buffer` types as ArrayBufferLike (it may back onto a SharedArrayBuffer),
  // which BlobPart does not accept; a plain Uint8Array copy satisfies the type.
  form.set("file", new Blob([new Uint8Array(await pngBytes())], { type: "image/png" }), "a.png");

  const encoded = new Response(form);
  const bytes = await encoded.arrayBuffer();
  const contentType = encoded.headers.get("content-type") ?? "multipart/form-data";

  const request = new NextRequest(`http://test/api/listings/${listingId}/images`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-forwarded-for": nextIp(),
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
    },
    body: bytes,
  });

  return POST(request, { params: Promise.resolve({ id: String(listingId) }) });
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  __resetStorageProvider();
});

describe("concurrent uploads to one listing", () => {
  it("assigns distinct sort orders", async () => {
    const { listing, token } = await seedSellerWithListing();

    await Promise.all([
      upload(listing.id, token),
      upload(listing.id, token),
      upload(listing.id, token),
    ]);

    const images = await listImagesFor(listing.id);
    const orders = images.map((image) => image.sortOrder).sort((a, b) => a - b);

    expect(images).toHaveLength(3);
    expect(orders).toEqual([0, 1, 2]);
  });

  it("never exceeds the image cap under concurrency", async () => {
    const { listing, token } = await seedSellerWithListing();

    // Several more than the cap, all at once. Without the lock the count check is a
    // TOCTOU and a batch of requests passes it together.
    await Promise.all(
      Array.from({ length: MAX_IMAGES_PER_LISTING + 3 }, () => upload(listing.id, token)),
    );

    expect(await listImagesFor(listing.id)).toHaveLength(MAX_IMAGES_PER_LISTING);
  });
});

describe("the size gate", () => {
  it("refuses a body with no Content-Length rather than buffering it", async () => {
    const { listing, token } = await seedSellerWithListing();

    const form = new FormData();
    // Buffer's `.buffer` types as ArrayBufferLike (it may back onto a SharedArrayBuffer),
    // which BlobPart does not accept; a plain Uint8Array copy satisfies the type.
    form.set("file", new Blob([new Uint8Array(await pngBytes())], { type: "image/png" }), "a.png");

    const request = new NextRequest(`http://test/api/listings/${listing.id}/images`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    // Strip what the runtime added: this is the chunked case, where the header is absent.
    request.headers.delete("content-length");

    const response = await POST(request, {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(411);
  });
});
