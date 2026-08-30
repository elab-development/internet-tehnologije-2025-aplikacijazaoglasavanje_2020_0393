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

  // Spec §4.3: "a half-finished listing is a draft its owner sees in their dashboard and
  // can finish or delete." The draft exclusion in listings-query.ts is scoped to browse,
  // search, similar-listings and recommendations — not to a seller's own inventory view
  // (`sellerId` = their own id, which flips `includeAllStatuses` on). Without this, a
  // draft becomes a permanently invisible, undeletable row holding uploaded blobs the
  // moment the first image lands on it.
  it("shows drafts in a seller's own inventory view", async () => {
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
    // status-active-only query would have dropped it too) — so `draft`'s presence is
    // attributable to the fix, not to some other filter already in effect.
    expect(ids).toContain(sold.id);
    expect(ids).toContain(draft.id);
  });

  // Anonymous browsing must still never see a draft — this is the case the fix above
  // must not regress.
  it("still omits drafts from an anonymous browse", async () => {
    const draft = await makeListing({ status: "draft" });

    const ids = (await browse()).data.map((l) => l.id);

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
