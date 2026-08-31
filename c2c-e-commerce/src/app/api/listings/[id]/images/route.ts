import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import {
  MAX_IMAGES_PER_LISTING,
  countImagesFor,
  insertImage,
  nextSortOrder,
  reorderImages,
  toImageSummary,
} from "@/db/listing-images";
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
import { StorageError, getStorageProvider } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

/** Spec §4.4. Bytes, not megabytes, so the comparison is unambiguous. */
const MAX_BYTES = 5 * 1024 * 1024;

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

    if ((await countImagesFor(listingId)) >= MAX_IMAGES_PER_LISTING) {
      return jsonError(`A listing may have at most ${MAX_IMAGES_PER_LISTING} images`, 409);
    }

    // Cheapest gate first: App Router route handlers have no default body cap, so
    // `await request.formData()` below buffers the whole body into memory before
    // `file.size` is ever consulted. A Content-Length check ahead of that is what
    // actually keeps an oversized upload's memory cost off the process — the two size
    // checks after formData() only bound what's already been paid for. The allowance
    // above MAX_BYTES accounts for the multipart envelope (headers, boundaries).
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES + 1024 * 1024) {
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

    const stored = await getStorageProvider().put(processed.webp, {
      contentType: "image/webp",
      prefix: `listings/${listingId}`,
    });

    const image = await insertImage({
      listingId,
      storageKey: stored.key,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      width: processed.width,
      height: processed.height,
      sortOrder: await nextSortOrder(listingId),
    });

    // Summary, not the row: `storageKey` is an internal address and never leaves the
    // server, not even to the listing's owner.
    return jsonOk(toImageSummary(image), 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
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

    // reorderImages scopes every update to this listing, so a foreign id in the array is
    // ignored rather than renumbered.
    await reorderImages(listingId, order as number[]);

    return jsonOk({ message: "Images reordered" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PATCH /api/listings/[id]/images]", err);
    return jsonError("Internal server error");
  }
}
