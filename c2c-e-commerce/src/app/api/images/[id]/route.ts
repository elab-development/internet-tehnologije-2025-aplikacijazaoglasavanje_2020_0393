import { NextRequest, NextResponse } from "next/server";

import { findImageWithListing } from "@/db/listing-images";
import { canMutateListing } from "@/lib/authorization";
import { isPubliclyVisible } from "@/lib/listing-visibility";
import { authenticate } from "@/lib/middleware";
import { parseResourceId } from "@/lib/params";
import { jsonError } from "@/lib/response";
import { StorageError, getStorageProvider } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * @swagger
 * /api/images/{id}:
 *   get:
 *     tags: [Listings]
 *     summary: Fetch a listing photo
 *     description: >
 *       Publicly visible only for a published listing (`active` or `sold`) — matching
 *       when the listings API itself would show the parent listing to an anonymous
 *       caller, plus `sold` so a completed purchase's photos keep rendering. A `draft` or
 *       `removed` listing's photos are visible only to its owner or an admin. Streams the
 *       stored bytes same-origin. Storage keys are random, so a URL never outlives the
 *       bytes it names.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The image
 *         content:
 *           image/webp:
 *             schema: { type: string, format: binary }
 *       400: { description: Invalid image id }
 *       404: { description: "Image not found, or not visible to this caller" }
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const imageId = parseResourceId((await params).id);
    if (!imageId) return jsonError("Invalid image id", 400);

    const found = await findImageWithListing(imageId);
    if (!found) return jsonError("Image not found", 404);
    const { image, status, sellerId } = found;

    // Optional auth, exactly as GET /api/listings/[id]: an anonymous caller is not an
    // error here, just someone who cannot be the owner or an admin.
    let isOwnerOrAdmin = false;
    try {
      const payload = authenticate(request);
      isOwnerOrAdmin = canMutateListing(payload, { sellerId });
    } catch {
      // Not authenticated — treat as public visitor.
    }

    // `active`, `reserved` and `sold` are all legitimately published — a purchase must
    // not un-publish a photo out from under the buyer's order history. `draft` and
    // `removed` are private to the owner/admin. Same message and status as a missing
    // row: the response must not reveal that the id exists.
    const isPublished = isPubliclyVisible(status);
    if (!isPublished && !isOwnerOrAdmin) return jsonError("Image not found", 404);

    const object = await getStorageProvider().get(image.storageKey);
    // A row whose object has vanished is a 404, not a 500: the bytes are gone either way
    // and the caller can do nothing with an error.
    if (!object) return jsonError("Image not found", 404);

    return new NextResponse(new Uint8Array(object.bytes), {
      status: 200,
      headers: {
        "Content-Type": object.contentType,
        "Content-Length": String(object.bytes.byteLength),
        // The bytes behind a key never change — a new upload gets a new key — so this can
        // be cached for a year without an invalidation story. But a `draft`/`removed`
        // image reaching this line is being served only because the caller is its
        // owner/admin — `public` here would let a shared cache hand it to the next,
        // anonymous visitor. `private` still permits year-long caching in that caller's
        // own browser, which is all the immutability guarantee ever promised.
        "Cache-Control": isPublished
          ? "public, max-age=31536000, immutable"
          : "private, max-age=31536000, immutable",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof StorageError) {
      console.error("[GET /api/images/[id]] storage", err);
      return jsonError("Image not found", 404);
    }
    console.error("[GET /api/images/[id]]", err);
    return jsonError("Internal server error");
  }
}
