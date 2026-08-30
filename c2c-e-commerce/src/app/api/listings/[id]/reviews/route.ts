import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { listings, orders, reviews, users } from "@/db/schema";
import { authenticate, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";
import { parseResourceId } from "@/lib/params";
import { parseRequest, CreateReviewSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };


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
    const listingId = parseResourceId((await params).id);
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
// Authenticated. No role gate — sellers buy too (D5) — only for a listing this caller
// has a `completed` order for.
// Body: { rating: number (1-5); comment?: string }

/**
 * @swagger
 * /api/listings/{id}/reviews:
 *   post:
 *     tags: [Reviews]
 *     summary: Create a review for a listing
 *     description: |
 *       Adds a review to a listing. Any authenticated user may review — sellers buy too —
 *       provided they have a `completed` order for this listing.
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
 *         description: >
 *           The caller has no completed order for this listing.
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
    // No role gate: sellers buy too (D5). The eligibility query below is the real
    // authorisation — it asks whether *this* caller received *this* listing.
    const payload = authenticate(request);

    const listingId = parseResourceId((await params).id);
    if (!listingId) return jsonError("Invalid listing id", 400);

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!listing) return jsonError("Listing not found", 404);

    const parsed = await parseRequest(request, CreateReviewSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { rating, comment } = parsed.data;

    // Only a buyer who actually received this listing may review it. `completed` is the
    // whole rule now — the hand-maintained list of "statuses that count as purchased" is
    // gone, and with it the chance of the list and the graph disagreeing.
    const [purchase] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.listingId, listingId),
          eq(orders.buyerId, payload.sub),
          eq(orders.status, "completed"),
        ),
      )
      .limit(1);

    if (!purchase) {
      return jsonError("You can only review a listing you have received", 403);
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
        rating,
        comment: comment ?? null,
      })
      .returning();

    return jsonOk(created, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[POST /api/listings/[id]/reviews]", err);
    return jsonError("Internal server error");
  }
}
