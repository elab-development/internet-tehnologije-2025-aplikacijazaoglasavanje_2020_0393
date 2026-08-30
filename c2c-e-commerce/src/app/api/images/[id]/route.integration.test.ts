/**
 * Part 2 spec — serving a stored image.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { insertImage } from "@/db/listing-images";
import { __resetStorageProvider, getStorageProvider } from "@/lib/storage";
import { resetDb } from "@/test/db";
import { makeListing } from "@/test/factories";

const BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);

beforeEach(async () => {
  await resetDb();
  __resetStorageProvider();
});

async function get(imageId: number) {
  const { GET } = await import("./route");
  return GET(new NextRequest(`http://localhost/api/images/${imageId}`), {
    params: Promise.resolve({ id: String(imageId) }),
  });
}

describe("GET /api/images/[id]", () => {
  it("returns the stored bytes with the right headers", async () => {
    const listing = await makeListing();
    const stored = await getStorageProvider().put(BYTES, {
      contentType: "image/webp",
      prefix: `listings/${listing.id}`,
    });
    const image = await insertImage({
      listingId: listing.id,
      storageKey: stored.key,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      width: 1,
      height: 1,
      sortOrder: 0,
    });

    const response = await get(image.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    // Without nosniff a browser may re-interpret the bytes as something executable.
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
  });

  it("404s for an unknown image id", async () => {
    expect((await get(999999)).status).toBe(404);
  });

  it("404s when the row exists but the object is gone", async () => {
    const listing = await makeListing();
    const image = await insertImage({
      listingId: listing.id,
      storageKey: `listings/${listing.id}/${"a".repeat(32)}.webp`,
      contentType: "image/webp",
      byteSize: 10,
      width: 1,
      height: 1,
      sortOrder: 0,
    });

    expect((await get(image.id)).status).toBe(404);
  });

  it("400s on a non-numeric id", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/images/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });

    expect(response.status).toBe(400);
  });
});
