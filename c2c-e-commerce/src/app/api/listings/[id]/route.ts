import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, listings, users } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import {
  computeListingEmbedding,
  needsReembedding,
  type EmbeddingOutcome,
} from "@/lib/ai/listing-embedding";
import { jsonError, jsonOk } from "@/lib/response";
import { parseResourceId } from "@/lib/params";
import { parseRequest, UpdateListingSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

// ─── Helpers ──────────────────────────────────────────────────────────────────


// ─── GET /api/listings/[id] ───────────────────────────────────────────────────
// Public. Returns a single active listing.

/**
 * @swagger
 * /api/listings/{id}:
 *   get:
 *     tags: [Listings]
 *     summary: Get a listing by ID
 *     description: |
 *       Returns a single listing with seller and category names.
 *       Only active listings are visible publicly; the owner or admin can see any status.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Listing ID
 *     responses:
 *       200:
 *         description: Listing details
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Listing'
 *                 - type: object
 *                   properties:
 *                     sellerName:
 *                       type: string
 *                       example: John Doe
 *                     categoryName:
 *                       type: string
 *                       nullable: true
 *                       example: Electronics
 *       400:
 *         description: Invalid listing id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Listing not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id: rawId } = await params;
    const id = parseResourceId(rawId);

    if (!id) {
      return jsonError(
        "Invalid listing id",
        400 );
    }

    const [listing] = await db
      .select({
        id: listings.id,
        title: listings.title,
        description: listings.description,
        imageUrl: listings.imageUrl,
        price: listings.price,
        status: listings.status,
        sellerId: listings.sellerId,
        categoryId: listings.categoryId,
        createdAt: listings.createdAt,
        sellerName: users.name,
        categoryName: categories.name,
      })
      .from(listings)
      .leftJoin(users, eq(users.id, listings.sellerId))
      .leftJoin(categories, eq(categories.id, listings.categoryId))
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) {
      return jsonError(
        "Listing not found",
        404
      );
    }

    // Allow the owner seller or admin to view their own non-active listings
    let isOwnerOrAdmin = false;
    try {
      const payload = authenticate(_request);
      if (payload.role === "admin" || payload.sub === listing.sellerId) {
        isOwnerOrAdmin = true;
      }
    } catch {
      // Not authenticated – treat as public visitor
    }

    // Only active listings are publicly visible
    if (listing.status !== "active" && !isOwnerOrAdmin) {
      return jsonError(
        "Listing not found",
        404 
      );
    }

    return jsonOk(listing);
  } catch (err) {
    console.error("[GET /api/listings/[id]]", err);
    return jsonError("Internal server error", 500);
  }
}

// ─── PUT /api/listings/[id] ───────────────────────────────────────────────────
// Authenticated. Role: owner seller or admin.

/**
 * @swagger
 * /api/listings/{id}:
 *   put:
 *     tags: [Listings]
 *     summary: Update a listing
 *     description: Updates an existing listing. Only the owner seller or an admin may update. Partial updates supported.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Listing ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: iPhone 15 Pro Max
 *               description:
 *                 type: string
 *                 example: Updated description
 *               price:
 *                 oneOf:
 *                   - type: number
 *                   - type: string
 *                 example: 1099.99
 *               imageUrl:
 *                 type: string
 *                 nullable: true
 *                 example: https://images.unsplash.com/photo-xyz
 *               categoryId:
 *                 type: integer
 *                 nullable: true
 *                 example: 3
 *               status:
 *                 type: string
 *                 enum: [active, sold, removed]
 *                 example: active
 *     responses:
 *       200:
 *         description: Listing updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Listing'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Not the owner or admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Listing not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    const { id: rawId } = await params;
    const id = parseResourceId(rawId);

    if (!id) {
      return jsonError("Invalid listing id",
        400
      );
    }

    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!listing) {
      return jsonError("Listing not found", 404);
    }

    // Only the owner or an admin may update
    if (payload.role !== "admin" && listing.sellerId !== payload.sub) {
      return jsonError("Forbidden", 403);
    }

    const parsed = await parseRequest(request, UpdateListingSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { title, description, price, imageUrl, categoryId, status } = parsed.data;

    // ── Build update payload (only provided fields) ───────────────────────────
    // The schema guarantees at least one field is present and that every value
    // is already validated and normalised; this only maps it onto the row.
    const updates: Partial<typeof listings.$inferInsert> = {};

    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = String(price);
    if (imageUrl !== undefined) updates.imageUrl = imageUrl;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (status !== undefined) updates.status = status;

    // Re-embed only when the embedded *text* actually changed. Comparing values rather
    // than which fields were sent means a client that PUTs the whole object on every save
    // does not pay for a new vector on a price edit (AC4).
    let outcome: EmbeddingOutcome | undefined;
    if (needsReembedding(listing, parsed.data)) {
      outcome = await computeListingEmbedding({
        title: title ?? listing.title,
        description: description ?? listing.description,
      });

      if (outcome.status === "embedded") {
        updates.embedding = outcome.embedding;
        updates.embeddingUpdatedAt = new Date();
      } else {
        // The text moved on but the vector could not follow. Clearing it keeps
        // `embedding IS NOT NULL` honest — AI-7 must not rank on a vector describing text
        // that no longer exists — and leaves the row for the backfill.
        updates.embedding = null;
        updates.embeddingUpdatedAt = null;
      }
    }

    const [updated] = await db
      .update(listings)
      .set(updates)
      .where(eq(listings.id, id))
      .returning();

    if (outcome?.status === "failed") {
      console.error(
        `[PUT /api/listings/[id]] embedding failed for listing ${updated.id}; stored without one`,
        outcome.error,
      );
    }

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[PUT /api/listings/[id]]", err);
    return jsonError("Internal server error", 500);
  }
}

// ─── DELETE /api/listings/[id] ────────────────────────────────────────────────
// Authenticated. Role: owner seller or admin.

/**
 * @swagger
 * /api/listings/{id}:
 *   delete:
 *     tags: [Listings]
 *     summary: Delete a listing
 *     description: Permanently removes a listing. Only the owner seller or an admin may delete.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Listing ID
 *     responses:
 *       200:
 *         description: Listing deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Listing deleted successfully
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Not the owner or admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Listing not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    const { id: rawId } = await params;
    const id = parseResourceId(rawId);

    if (!id) {
      return jsonError("Invalid listing id", 400);
    }

    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!listing) {
      return jsonError("Listing not found", 404);
    }

    // Only the owner or an admin may delete
    if (payload.role !== "admin" && listing.sellerId !== payload.sub) {
      return jsonError("Forbidden", 403);
    }

    await db.delete(listings).where(eq(listings.id, id));

    return jsonOk({ message: "Listing deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[DELETE /api/listings/[id]]", err);
    return jsonError("Internal server error", 500);
  }
}
