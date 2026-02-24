import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { listings, reviews, users } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

// ─── GET /api/listings/[id]/reviews ──────────────────────────────────────────
// Public.

/**
 * @swagger
 * /api/listings/{id}/reviews:
 *   get:
 *     tags: [Reviews]
 *     summary: List reviews for a listing
 *     description: Returns all reviews for a specific listing, including the reviewer name.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Listing ID
 *     responses:
 *       200:
 *         description: Array of reviews
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/Review'
 *                   - type: object
 *                     properties:
 *                       reviewerName:
 *                         type: string
 *                         nullable: true
 *                         example: Jane Smith
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
    const listingId = parseId((await params).id);
    if (!listingId) return jsonError("Invalid listing id", 400);

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!listing) return jsonError("Listing not found", 404);

    const rows = await db
      .select()
      .from(reviews)
      .leftJoin(users, eq(users.id, reviews.reviewerId))
      .where(eq(reviews.listingId, listingId))
      .orderBy(reviews.createdAt);

    return jsonOk(
      rows.map((row) => ({
        ...row.reviews,
        reviewerName: row.users?.name ?? null,
      }))
    );
  } catch (err) {
    console.error("[GET /api/listings/[id]/reviews]", err);
    return jsonError("Internal server error");
  }
}

// ─── POST /api/listings/[id]/reviews ─────────────────────────────────────────
// Authenticated. Role: buyer.
// Body: { rating: number (1-5); comment?: string }

/**
 * @swagger
 * /api/listings/{id}/reviews:
 *   post:
 *     tags: [Reviews]
 *     summary: Create a review for a listing
 *     description: |
 *       Adds a review to a listing. Only buyers can review.
 *       A user can only submit one review per listing.
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
 *             required: [rating]
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 4
 *               comment:
 *                 type: string
 *                 nullable: true
 *                 example: Great product!
 *     responses:
 *       201:
 *         description: Review created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Review'
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
 *         description: Not a buyer
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
 *       409:
 *         description: Already reviewed this listing
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
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("buyer")(payload);

    const listingId = parseId((await params).id);
    if (!listingId) return jsonError("Invalid listing id", 400);

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!listing) return jsonError("Listing not found", 404);

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);

    const { rating, comment } = body as Record<string, unknown>;

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return jsonError("rating must be an integer between 1 and 5", 400);
    }

    // Prevent duplicate review for the same listing
    const [existingReview] = await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.reviewerId, payload.sub), eq(reviews.listingId, listingId)))
      .limit(1);
    if (existingReview) return jsonError("You have already reviewed this listing", 409);

    const [created] = await db
      .insert(reviews)
      .values({
        reviewerId: payload.sub,
        listingId,
        rating: ratingNum,
        comment: typeof comment === "string" && comment.trim() ? comment.trim() : null,
      })
      .returning();

    return jsonOk(created, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[POST /api/listings/[id]/reviews]", err);
    return jsonError("Internal server error");
  }
}
