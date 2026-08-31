import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import {
  LISTING_IMAGES_SORT_INDEX,
  MAX_IMAGES_PER_LISTING,
  countImagesFor,
  deleteImage,
  insertImage,
  listImagesFor,
  nextSortOrder,
  reorderImages,
  toImageSummary,
} from "@/db/listing-images";
import { isUniqueViolation } from "@/db/pg-errors";
import { listings } from "@/db/schema";
import { canMutateListing } from "@/lib/authorization";
import { ImageProcessingError, processUploadedImage } from "@/lib/image-pipeline";
import { AuthError, authenticate } from "@/lib/middleware";
import { parseResourceId } from "@/lib/params";
import {
  IMAGE_UPLOAD_RATE_LIMIT,
  rateLimitByKey,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { jsonError, jsonOk } from "@/lib/response";
import { StorageError, getStorageProvider, storageKey } from "@/lib/storage";

export { MAX_IMAGES_PER_LISTING };

type RouteContext = { params: Promise<{ id: string }> };

/** Spec §4.4. Bytes, not megabytes, so the comparison is unambiguous. */
const MAX_BYTES = 5 * 1024 * 1024;

/** The cap was reached while holding the listing's row lock. */
class ImageLimitReached extends Error {}

/**
 * `order` no longer matched the listing's actual image set once its row lock was held.
 *
 * Distinct from the pre-lock version of this same check (still a 400): this is what
 * catches a concurrent upload or delete landing between that check and the lock.
 */
class ReorderMismatch extends Error {}

/** The listing was deleted between the ownership check and the row lock. */
class ListingGoneMidReorder extends Error {}

/**
 * @swagger
 * /api/listings/{id}/images:
 *   post:
 *     tags: [Listings]
 *     summary: Upload a photo to a listing
 *     description: >
 *       Multipart upload of a single `file`. The type is decided from the file's magic
 *       bytes, never its declared Content-Type or filename, and the image is re-encoded
 *       to WebP — which also strips EXIF, including any GPS coordinates. Owner or admin
 *       only. At most 8 images per listing, 5 MB each.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       201:
 *         description: The stored image
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListingImage'
 *       400: { description: "Not a JPEG, PNG or WebP" }
 *       401: { description: Missing or invalid token }
 *       403: { description: Not the listing's owner }
 *       404: { description: Listing not found }
 *       409: { description: Image limit reached }
 *       413: { description: File too large }
 *       429: { description: Rate limited }
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const limit = rateLimitByKey(`images:user:${payload.sub}`, IMAGE_UPLOAD_RATE_LIMIT);
    if (!limit.allowed) {
      return jsonError(
        "Too many image uploads. Please try again later.",
        429,
        rateLimitHeaders(limit, IMAGE_UPLOAD_RATE_LIMIT),
      );
    }

    const listingId = parseResourceId((await params).id);
    if (!listingId) return jsonError("Invalid listing id", 400);

    const [listing] = await db
      .select({ id: listings.id, sellerId: listings.sellerId })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!listing) return jsonError("Listing not found", 404);

    if (!canMutateListing(payload, listing)) {
      return jsonError("Forbidden: this listing is not yours", 403);
    }

    // Cheapest gate first: App Router route handlers have no default body cap, so
    // `await request.formData()` below buffers the whole body into memory before
    // `file.size` is ever consulted. This check is what keeps an oversized upload's
    // memory cost off the process; the two size checks after formData() only bound what
    // has already been paid for.
    //
    // A missing header is not zero. `Number(null)` is 0 -- finite, and under any cap --
    // so treating it as a size let a chunked body skip this gate entirely and buffer
    // without limit. 411 is the status that actually means "tell me how big it is".
    const rawLength = request.headers.get("content-length");
    const contentLength = rawLength === null ? Number.NaN : Number(rawLength);

    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return jsonError("A Content-Length header is required for uploads", 411);
    }
    // The allowance above MAX_BYTES accounts for the multipart envelope.
    if (contentLength > MAX_BYTES + 1024 * 1024) {
      return jsonError("That image is larger than 5 MB", 413);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return jsonError("Expected a file field named `file`", 400);

    if (file.size > MAX_BYTES) {
      return jsonError("That image is larger than 5 MB", 413);
    }

    const incoming = Buffer.from(await file.arrayBuffer());

    // Size is checked twice on purpose: Blob.size is what the client claimed, and this is
    // what actually arrived.
    if (incoming.byteLength > MAX_BYTES) {
      return jsonError("That image is larger than 5 MB", 413);
    }

    let processed;
    try {
      processed = await processUploadedImage(incoming);
    } catch (err) {
      if (err instanceof ImageProcessingError) {
        // Logged even though the response is a 400: this branch failing broadly (a
        // broken sharp binary, an OOM) would otherwise look like "every upload is
        // suddenly invalid" with no server-side trace.
        if (err.kind === "undecodable") {
          console.warn("[POST /api/listings/[id]/images] decode failed", err.cause);
        }
        return jsonError(err.message, 400);
      }
      throw err;
    }

    // The key is generated here so the row can be written before the object. Two systems
    // cannot be atomic, so this does not remove the failure -- it converts it into one
    // that is detectable and repairable. Object-then-row leaves an *untracked* orphan:
    // no row, so nothing can ever enumerate it. Row-then-object leaves a row pointing at
    // a missing object, which a sweep can find.
    const key = storageKey(`listings/${listingId}`, "webp");

    // One row lock, three races. The image-count TOCTOU, nextSortOrder's read-then-write
    // and the ordering above are one serialisation problem: concurrent uploads to the
    // same listing queue behind this lock, and uploads to different listings never
    // contend. The unique index from migration 0020 is the backstop.
    const image = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.id, listingId))
        .for("update")
        .limit(1);

      // Deleted between the authorisation read and this lock.
      if (!locked) return null;

      if ((await countImagesFor(listingId, tx)) >= MAX_IMAGES_PER_LISTING) {
        throw new ImageLimitReached();
      }

      return insertImage(
        {
          listingId,
          storageKey: key,
          contentType: "image/webp",
          byteSize: processed.webp.byteLength,
          width: processed.width,
          height: processed.height,
          sortOrder: await nextSortOrder(listingId, tx),
        },
        tx,
      );
    });

    if (image === null) return jsonError("Listing not found", 404);

    try {
      await getStorageProvider().put(processed.webp, {
        contentType: "image/webp",
        prefix: `listings/${listingId}`,
        key,
      });
    } catch (err) {
      // The row is committed and the object is not. Remove the row so the pair stays
      // consistent; if this also fails, the row survives pointing at a missing object --
      // the detectable failure this ordering was chosen for, logged rather than silent.
      try {
        await deleteImage(image.id);
      } catch (cleanupErr) {
        console.error(
          "[POST /api/listings/[id]/images] row left pointing at a missing object",
          image.id,
          key,
          cleanupErr,
        );
      }
      throw err;
    }

    // Summary, not the row: `storageKey` is an internal address and never leaves the
    // server, not even to the listing's owner.
    return jsonOk(toImageSummary(image), 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    if (err instanceof ImageLimitReached) {
      return jsonError(`A listing may have at most ${MAX_IMAGES_PER_LISTING} images`, 409);
    }
    // The backstop from migration 0020: a lost race is a conflict, not a server fault.
    if (isUniqueViolation(err, LISTING_IMAGES_SORT_INDEX)) {
      return jsonError("Another upload for this listing is in progress. Try again.", 409);
    }
    if (err instanceof StorageError) {
      console.error("[POST /api/listings/[id]/images] storage", err);
      return jsonError("Could not store that image", 500);
    }
    console.error("[POST /api/listings/[id]/images]", err);
    return jsonError("Internal server error");
  }
}

/**
 * @swagger
 * /api/listings/{id}/images:
 *   patch:
 *     tags: [Listings]
 *     summary: Reorder a listing's photos
 *     description: >
 *       Body `{ order: number[] }` — image ids in their new order. Owner or admin.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Reordered }
 *       400: { description: Invalid body }
 *       401: { description: Missing or invalid token }
 *       403: { description: Not the listing's owner }
 *       404: { description: Listing not found }
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const listingId = parseResourceId((await params).id);
    if (!listingId) return jsonError("Invalid listing id", 400);

    const [listing] = await db
      .select({ id: listings.id, sellerId: listings.sellerId })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!listing) return jsonError("Listing not found", 404);

    if (!canMutateListing(payload, listing)) {
      return jsonError("Forbidden: this listing is not yours", 403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const order = (body as { order?: unknown }).order;
    if (!Array.isArray(order) || !order.every((id) => Number.isInteger(id) && id > 0)) {
      return jsonError("`order` must be an array of image ids", 400);
    }

    const orderedIds = order as number[];

    // Same row lock as the upload path (Task 9). Reading the listing's current image ids
    // and validating `order` against them used to happen outside any transaction, so a
    // concurrent upload or delete landing between that read and `reorderImages`'s own
    // transaction could invalidate a validation that had already passed. Taking the lock
    // first makes the read, the validation and the write one atomic step.
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.id, listingId))
        .for("update")
        .limit(1);

      // Deleted between the authorisation read and this lock.
      if (!locked) throw new ListingGoneMidReorder();

      // `reorderImages` stages every id in `order` at a negative sort_order before writing
      // final positions 0..order.length-1, which only guarantees no collision *among the
      // ids it stages* (see its own comment). An `order` that omits one of the listing's
      // images, repeats one, or substitutes a foreign id asks phase two to write a final
      // position that collides with a row nobody staged -- the unique index now rejects
      // that as a 500 on client-controlled input, where before it silently produced a
      // duplicate sort_order. The documented contract above is "image ids in their new
      // order", i.e. the complete set, so anything short of that is a 400, not a guess.
      const currentIds = (await listImagesFor(listingId, tx)).map((image) => image.id);
      const isCompleteReordering =
        orderedIds.length === currentIds.length &&
        new Set(orderedIds).size === orderedIds.length &&
        currentIds.every((id) => orderedIds.includes(id));

      if (!isCompleteReordering) throw new ReorderMismatch();

      await reorderImages(listingId, orderedIds, tx);
    });

    return jsonOk({ message: "Images reordered" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    if (err instanceof ListingGoneMidReorder) return jsonError("Listing not found", 404);
    if (err instanceof ReorderMismatch) {
      return jsonError(
        "`order` must contain each of the listing's image ids exactly once",
        400,
      );
    }
    console.error("[PATCH /api/listings/[id]/images]", err);
    return jsonError("Internal server error");
  }
}
