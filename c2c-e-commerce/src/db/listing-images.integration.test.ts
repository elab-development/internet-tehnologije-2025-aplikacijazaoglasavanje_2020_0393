/**
 * Part 2 spec — the image query helpers.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  coverImageIdFor,
  countImagesFor,
  deleteImage,
  findImage,
  listImagesFor,
  nextSortOrder,
  reorderImages,
} from "@/db/listing-images";
import { resetDb } from "@/test/db";
import { makeListing, makeListingImage } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

describe("listImagesFor", () => {
  it("returns images in sortOrder", async () => {
    const listing = await makeListing();
    const second = await makeListingImage({ listingId: listing.id, sortOrder: 1 });
    const first = await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    const images = await listImagesFor(listing.id);

    expect(images.map((i) => i.id)).toEqual([first.id, second.id]);
  });

  it("returns empty for a listing with none", async () => {
    const listing = await makeListing();

    expect(await listImagesFor(listing.id)).toEqual([]);
  });
});

describe("countImagesFor / nextSortOrder", () => {
  it("counts and appends after the highest", async () => {
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 0 });
    await makeListingImage({ listingId: listing.id, sortOrder: 5 });

    expect(await countImagesFor(listing.id)).toBe(2);
    expect(await nextSortOrder(listing.id)).toBe(6);
  });

  it("starts at 0 for an empty listing", async () => {
    const listing = await makeListing();

    expect(await countImagesFor(listing.id)).toBe(0);
    expect(await nextSortOrder(listing.id)).toBe(0);
  });

  // `max(sort_order)` returns SQL NULL for zero rows and the number 0 for one row whose
  // sortOrder really is 0 — two different reasons to see a falsy-looking value, and only
  // one of them means "empty". Getting this wrong silently collides the cover image: a
  // second upload landing at sortOrder 0 again, on top of the first.
  it("returns 1 when the only image has sortOrder 0 — a real zero, not the no-rows NULL", async () => {
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    expect(await nextSortOrder(listing.id)).toBe(1);
  });
});

describe("findImage / deleteImage", () => {
  it("finds and then deletes, returning the removed row", async () => {
    const listing = await makeListing();
    const image = await makeListingImage({ listingId: listing.id });

    expect((await findImage(image.id))?.id).toBe(image.id);

    const deleted = await deleteImage(image.id);

    // The caller needs the storage key to delete the object; a bare boolean would
    // strand the bytes on disk forever.
    expect(deleted?.storageKey).toBe(image.storageKey);
    expect(await findImage(image.id)).toBeNull();
  });

  it("answers null for an unknown id", async () => {
    expect(await findImage(999999)).toBeNull();
    expect(await deleteImage(999999)).toBeNull();
  });
});

describe("reorderImages", () => {
  it("rewrites sortOrder to match the given sequence", async () => {
    const listing = await makeListing();
    const a = await makeListingImage({ listingId: listing.id, sortOrder: 0 });
    const b = await makeListingImage({ listingId: listing.id, sortOrder: 1 });
    const c = await makeListingImage({ listingId: listing.id, sortOrder: 2 });

    await reorderImages(listing.id, [c.id, a.id, b.id]);

    const images = await listImagesFor(listing.id);
    expect(images.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
  });

  it("ignores ids that belong to another listing", async () => {
    const mine = await makeListing();
    const theirs = await makeListing();
    const a = await makeListingImage({ listingId: mine.id, sortOrder: 0 });
    // A distinct sortOrder is what makes this test able to fail: an unscoped update
    // would rewrite it to 0 (its index in the array below), so the assertion has
    // something to detect. With the foreign row also at 0, scoped and unscoped
    // produce identical state and the test proves nothing.
    const foreign = await makeListingImage({ listingId: theirs.id, sortOrder: 5 });

    await reorderImages(mine.id, [foreign.id, a.id]);

    // Membership cannot change — reorder never rewrites listingId — but assert it
    // anyway so a future change that did move rows would be caught here.
    expect((await listImagesFor(mine.id)).map((i) => i.id)).toEqual([a.id]);
    expect((await listImagesFor(theirs.id)).map((i) => i.id)).toEqual([foreign.id]);

    // THE assertion: the foreign row's position was not rewritten by a reorder
    // scoped to someone else's listing.
    const [untouched] = await listImagesFor(theirs.id);
    expect(untouched.sortOrder).toBe(5);
  });
});

describe("coverImageIdFor", () => {
  it("is the lowest sortOrder", async () => {
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 3 });
    const cover = await makeListingImage({ listingId: listing.id, sortOrder: 1 });

    expect(await coverImageIdFor(listing.id)).toBe(cover.id);
  });

  it("is null when there are none", async () => {
    const listing = await makeListing();

    expect(await coverImageIdFor(listing.id)).toBeNull();
  });
});
