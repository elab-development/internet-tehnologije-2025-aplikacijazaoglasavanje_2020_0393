// ─── Listing image queries ────────────────────────────────────────────────────
// Part 2 of the 2026-08-30 redesign. Everything the routes need to ask about images,
// in one place, so the routes stay about HTTP.

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "./index";
import {
  listingImages,
  listings,
  type Listing,
  type ListingImage,
  type NewListingImage,
} from "./schema";

/** Spec §4.4. Enough for a second-hand listing; small enough to bound the upload cost. */
export const MAX_IMAGES_PER_LISTING = 8;

export async function listImagesFor(listingId: number): Promise<ListingImage[]> {
  return db
    .select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .orderBy(asc(listingImages.sortOrder), asc(listingImages.id));
}

export async function countImagesFor(listingId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId));

  return row?.count ?? 0;
}

/** One past the highest existing order, so an upload appends rather than collides. */
export async function nextSortOrder(listingId: number): Promise<number> {
  const [row] = await db
    .select({ highest: sql<number | null>`max(${listingImages.sortOrder})` })
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId));

  return row?.highest === null || row?.highest === undefined ? 0 : row.highest + 1;
}

export async function insertImage(values: NewListingImage): Promise<ListingImage> {
  const [image] = await db.insert(listingImages).values(values).returning();
  return image;
}

export async function findImage(imageId: number): Promise<ListingImage | null> {
  const [image] = await db
    .select()
    .from(listingImages)
    .where(eq(listingImages.id, imageId))
    .limit(1);

  return image ?? null;
}

/**
 * An image plus enough of its parent listing to decide who may see it.
 *
 * `GET /api/images/[id]` (Part 2) needs the listing's publication status and seller —
 * a photo of a `draft` or `removed` listing is private to its owner even though the
 * image row itself carries no visibility of its own.
 */
export async function findImageWithListing(
  imageId: number,
): Promise<{ image: ListingImage; status: Listing["status"]; sellerId: number } | null> {
  const [row] = await db
    .select({
      image: listingImages,
      status: listings.status,
      sellerId: listings.sellerId,
    })
    .from(listingImages)
    .innerJoin(listings, eq(listings.id, listingImages.listingId))
    .where(eq(listingImages.id, imageId))
    .limit(1);

  return row ?? null;
}

/**
 * Deletes a row and hands it back.
 *
 * The row carries the storage key, and the caller needs it to delete the object. A
 * boolean return would leave the bytes on disk with nothing pointing at them.
 */
export async function deleteImage(imageId: number): Promise<ListingImage | null> {
  const [deleted] = await db
    .delete(listingImages)
    .where(eq(listingImages.id, imageId))
    .returning();

  return deleted ?? null;
}

/**
 * Renumbers a listing's images to match `orderedIds`.
 *
 * Scoped to the listing on every update: an id belonging to someone else's listing must
 * not be renumbered into this sequence, and the scope is what stops a caller reordering
 * a listing they do not own by passing its image ids.
 */
export async function reorderImages(listingId: number, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;

  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(listingImages)
        .set({ sortOrder: index })
        .where(and(eq(listingImages.id, id), eq(listingImages.listingId, listingId)));
    }
  });
}

export async function coverImageIdFor(listingId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: listingImages.id })
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .orderBy(asc(listingImages.sortOrder), asc(listingImages.id))
    .limit(1);

  return row?.id ?? null;
}

/**
 * The client-facing shape of an image.
 *
 * `storageKey` is deliberately absent: it is the address the storage layer resolves, and
 * a caller has no use for it. The public handle is the row id, which `/api/images/{id}`
 * takes. `listingId` and `createdAt` are dropped as noise the caller already knows or
 * does not need.
 */
export function toImageSummary(image: ListingImage): {
  id: number;
  sortOrder: number;
  width: number | null;
  height: number | null;
} {
  return {
    id: image.id,
    sortOrder: image.sortOrder,
    width: image.width,
    height: image.height,
  };
}

/** Ids of every image on these listings, for the list projection. Unused ids are omitted. */
export async function coverImageIdsFor(
  listingIds: number[],
): Promise<Map<number, number>> {
  if (listingIds.length === 0) return new Map();

  const rows = await db
    .select({
      listingId: listingImages.listingId,
      id: listingImages.id,
      sortOrder: listingImages.sortOrder,
    })
    .from(listingImages)
    .where(inArray(listingImages.listingId, listingIds))
    .orderBy(asc(listingImages.sortOrder), asc(listingImages.id));

  const covers = new Map<number, number>();
  for (const row of rows) {
    if (!covers.has(row.listingId)) covers.set(row.listingId, row.id);
  }
  return covers;
}
