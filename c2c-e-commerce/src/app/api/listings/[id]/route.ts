import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, listings, users } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonError, jsonOk } from "@/lib/response";

type RouteContext = { params: Promise<{ id: string }> };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) ? null : id;
}

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
    const id = parseId(rawId);

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
        "Invalid listing id ,Listing not found",
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
    const id = parseId(rawId);

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

    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return jsonError("Invalid request body", 400);
    }

    const { title, description, price, imageUrl, categoryId, status } = body as Record<string, unknown>;

    // ── Build update payload (only provided fields) ───────────────────────────
    const updates: Partial<typeof listings.$inferInsert> = {};

    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return jsonError("title must be a non-empty string", 400);
      }
      updates.title = title.trim();
    }

    if (description !== undefined) {
      if (typeof description !== "string" || !description.trim()) {
        return jsonError("description must be a non-empty string", 400);
      }
      updates.description = description.trim();
    }

    if (price !== undefined) {
      const priceNum = typeof price === "string" ? parseFloat(price) : typeof price === "number" ? price : NaN;
      if (isNaN(priceNum) || priceNum < 0) {
        return jsonError("price must be a non-negative number", 400);
      }
      updates.price = String(priceNum);
    }

    if (imageUrl !== undefined) {
      if (imageUrl === null) {
        updates.imageUrl = null;
      } else {
        if (typeof imageUrl !== "string") {
          return jsonError("imageUrl must be a string", 400);
        }

        const trimmed = imageUrl.trim();
        if (!trimmed) {
          updates.imageUrl = null;
        } else {
          try {
            const parsed = new URL(trimmed);
            if (!["http:", "https:"].includes(parsed.protocol)) {
              return jsonError("imageUrl must be a valid http or https URL", 400);
            }
            updates.imageUrl = parsed.toString();
          } catch {
            return jsonError("imageUrl must be a valid URL", 400);
          }
        }
      }
    }

    if (categoryId !== undefined) {
      updates.categoryId = categoryId === null ? null : Number(categoryId);
    }

    if (status !== undefined) {
      const allowed = ["active", "sold", "removed"] as const;
      if (!allowed.includes(status as (typeof allowed)[number])) {
        return jsonError(`status must be one of: ${allowed.join(", ")}`, 400);
      }
      updates.status = status as (typeof allowed)[number];
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("No updatable fields provided", 400);
    }

    const [updated] = await db
      .update(listings)
      .set(updates)
      .where(eq(listings.id, id))
      .returning();

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
    const id = parseId(rawId);

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
