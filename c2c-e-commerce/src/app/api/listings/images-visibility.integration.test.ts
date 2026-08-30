/**
 * Part 2 spec — what the read paths expose.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { signToken } from "@/lib/auth";
import { resetDb } from "@/test/db";
import { makeListing, makeListingImage, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function browse() {
  const { GET } = await import("./route");
  const response = await GET(new NextRequest("http://localhost/api/listings?limit=50"));
  return (await response.json()) as { data: { id: number; coverImageId: number | null }[] };
}

describe("GET /api/listings", () => {
  it("carries the cover image id — the lowest sortOrder", async () => {
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 2 });
    const cover = await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    const found = (await browse()).data.find((l) => l.id === listing.id);

    expect(found?.coverImageId).toBe(cover.id);
  });

  it("carries null for a listing with no images", async () => {
    const listing = await makeListing();

    expect((await browse()).data.find((l) => l.id === listing.id)?.coverImageId).toBeNull();
  });

  it("omits drafts", async () => {
    const draft = await makeListing({ status: "draft" });
    const active = await makeListing({ status: "active" });

    const ids = (await browse()).data.map((l) => l.id);

    expect(ids).toContain(active.id);
    expect(ids).not.toContain(draft.id);
  });

  // Anonymous browsing already narrows to `status = active`, so a draft never reaches
  // that path regardless of this exclusion — it is not what makes the case above pass.
  // The exclusion is load-bearing precisely where a caller is otherwise allowed every
  // status: the seller viewing their own inventory (`sellerId` = their own id, which
  // flips `includeAllStatuses` on in listings-query.ts).
  it("omits drafts from a seller's own inventory view too", async () => {
    const seller = await makeUser({ role: "seller" });
    const token = signToken({ sub: seller.id, email: seller.email, role: seller.role });
    const draft = await makeListing({ sellerId: seller.id, status: "draft" });
    const sold = await makeListing({ sellerId: seller.id, status: "sold" });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(`http://localhost/api/listings?sellerId=${seller.id}&limit=50`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const ids = ((await response.json()) as { data: { id: number }[] }).data.map((l) => l.id);

    // `sold` proves this really is the all-statuses branch (an anonymous or
    // status-active-only query would have dropped it too) — so `draft`'s absence is
    // attributable to the exclusion, not to some other filter already in effect.
    expect(ids).toContain(sold.id);
    expect(ids).not.toContain(draft.id);
  });
});

describe("GET /api/listings/[id]", () => {
  it("carries every image in order", async () => {
    const listing = await makeListing();
    const second = await makeListingImage({ listingId: listing.id, sortOrder: 1 });
    const first = await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    const { GET } = await import("./[id]/route");
    const response = await GET(
      new NextRequest(`http://localhost/api/listings/${listing.id}`),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );
    const detail = (await response.json()) as { images: { id: number }[] };

    expect(detail.images.map((i) => i.id)).toEqual([first.id, second.id]);
  });

  it("carries an empty array for a listing with none", async () => {
    const listing = await makeListing();

    const { GET } = await import("./[id]/route");
    const response = await GET(
      new NextRequest(`http://localhost/api/listings/${listing.id}`),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );

    expect((await response.json()).images).toEqual([]);
  });

  it("carries coverImageId — the lowest sortOrder, same as images[0]", async () => {
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 1 });
    const cover = await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    const { GET } = await import("./[id]/route");
    const response = await GET(
      new NextRequest(`http://localhost/api/listings/${listing.id}`),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );
    const detail = (await response.json()) as {
      coverImageId: number | null;
      images: { id: number }[];
    };

    expect(detail.coverImageId).toBe(cover.id);
    expect(detail.coverImageId).toBe(detail.images[0].id);
  });

  it("carries coverImageId: null for a listing with no images", async () => {
    const listing = await makeListing();

    const { GET } = await import("./[id]/route");
    const response = await GET(
      new NextRequest(`http://localhost/api/listings/${listing.id}`),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );
    const detail = (await response.json()) as { coverImageId: number | null; images: unknown[] };

    expect(detail.coverImageId).toBeNull();
    expect(detail.images).toEqual([]);
  });
});
