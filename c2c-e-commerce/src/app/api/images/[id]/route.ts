import { NextRequest, NextResponse } from "next/server";

import { findImage } from "@/db/listing-images";
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
 *       Public. Streams the stored bytes same-origin. Storage keys are random, so a URL
 *       never outlives the bytes it names and the response is cached immutably.
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
 *       404: { description: Image not found }
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const imageId = parseResourceId((await params).id);
    if (!imageId) return jsonError("Invalid image id", 400);

    const image = await findImage(imageId);
    if (!image) return jsonError("Image not found", 404);

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
        // be cached for a year without an invalidation story.
        "Cache-Control": "public, max-age=31536000, immutable",
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
