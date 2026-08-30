import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";

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
import { sniffImageType } from "@/lib/image-type";
import { AuthError, authenticate } from "@/lib/middleware";
import { parseResourceId } from "@/lib/params";
import {
  IMAGE_UPLOAD_RATE_LIMIT,
  getClientIp,
  rateLimit,
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
 *       201: { description: The stored image }
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

    const limit = rateLimit(`images:${getClientIp(request)}`, IMAGE_UPLOAD_RATE_LIMIT);
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

    // The bytes decide, not the multipart Content-Type and not the filename.
    if (sniffImageType(incoming) === null) {
      return jsonError("That file is not a JPEG, PNG or WebP image", 400);
    }

    // Re-encoding is the point, not a formatting nicety: it drops EXIF — including the
    // GPS coordinates phone cameras attach — and a decode-then-encode cycle cannot carry
    // a polyglot payload through (D10).
    //
    // The size checks above bound the *compressed* bytes only. Without a decode-side
    // bound, a 5 MB PNG or WebP can still be crafted to decode to ~200 megapixels —
    // sharp's own default ceiling — which allocates roughly 600 MB of raw pixels in this
    // process. `limitInputPixels` caps that; `resize` additionally caps what gets stored,
    // which nothing else here does.
    let webp: Buffer;
    let width: number | null = null;
    let height: number | null = null;
    try {
      const output = await sharp(incoming, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 4000, height: 4000, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      webp = output.data;
      width = output.info.width;
      height = output.info.height;
    } catch (err) {
      // Sniffed as an image but undecodable: truncated, crafted to look like one, or
      // rejected by limitInputPixels. This branch failing broadly (a broken sharp
      // binary, an OOM) would look like "every upload is suddenly invalid" with no
      // server-side trace otherwise, so it's logged even though the response stays 400.
      console.warn("[POST /api/listings/[id]/images] decode failed", err);
      return jsonError("That image could not be processed", 400);
    }

    const stored = await getStorageProvider().put(webp, {
      contentType: "image/webp",
      prefix: `listings/${listingId}`,
    });

    const image = await insertImage({
      listingId,
      storageKey: stored.key,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      width,
      height,
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
