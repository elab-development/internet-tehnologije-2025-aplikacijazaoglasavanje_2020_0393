import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import { deleteImage, findImage } from "@/db/listing-images";
import { listings } from "@/db/schema";
import { canMutateListing } from "@/lib/authorization";
import { AuthError, authenticate } from "@/lib/middleware";
import { parseResourceId } from "@/lib/params";
import { jsonError, jsonOk } from "@/lib/response";
import { StorageError, getStorageProvider } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string; imageId: string }> };

/**
 * @swagger
 * /api/listings/{id}/images/{imageId}:
 *   delete:
 *     tags: [Listings]
 *     summary: Remove a photo from a listing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Deleted }
 *       401: { description: Missing or invalid token }
 *       403: { description: Not the listing's owner }
 *       404: { description: Listing or image not found }
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const { id, imageId: rawImageId } = await params;
    const listingId = parseResourceId(id);
    const imageId = parseResourceId(rawImageId);
    if (!listingId || !imageId) return jsonError("Invalid id", 400);

    const [listing] = await db
      .select({ id: listings.id, sellerId: listings.sellerId })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!listing) return jsonError("Listing not found", 404);

    if (!canMutateListing(payload, listing)) {
      return jsonError("Forbidden: this listing is not yours", 403);
    }

    const image = await findImage(imageId);
    // Ownership is settled before the image's existence is revealed, and the image must
    // belong to the listing in the path — otherwise an owner of listing A could delete
    // an image of listing B by naming it in A's URL.
    if (!image || image.listingId !== listingId) return jsonError("Image not found", 404);

    const deleted = await deleteImage(imageId);

    if (deleted) {
      // Row first, object second: a deleted row with a surviving object is wasted disk,
      // while a surviving row pointing at a deleted object is a broken image on a page.
      try {
        await getStorageProvider().delete(deleted.storageKey);
      } catch (err) {
        if (!(err instanceof StorageError)) throw err;
        console.error("[DELETE image] object left behind", deleted.storageKey, err);
      }
    }

    return jsonOk({ message: "Image deleted" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/listings/[id]/images/[imageId]]", err);
    return jsonError("Internal server error");
  }
}
