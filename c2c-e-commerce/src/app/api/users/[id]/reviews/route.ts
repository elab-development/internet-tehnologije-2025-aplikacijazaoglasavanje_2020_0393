import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { reviews, users } from "@/db/schema";
import { parseBoundedInt, parseResourceId } from "@/lib/params";
import { jsonOk, jsonError } from "@/lib/response";
import { ratingAverage } from "@/lib/reviews";

type RouteContext = { params: Promise<{ id: string }> };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ─── GET /api/users/[id]/reviews ──────────────────────────────────────────────
// Public. A seller's reputation and the reviews behind it.

/**
 * @swagger
 * /api/users/{id}/reviews:
 *   get:
 *     tags: [Reviews]
 *     summary: A seller's reviews, newest first
 *     description: |
 *       Public and paginated. The `seller` envelope carries the denormalised reputation
 *       (D7) and a derived `averageRating` — `null` for a seller nobody has reviewed,
 *       because a 0 would read as five one-star reviews.
 *
 *       Deliberately narrow: the display name, the avatar and the two counters, and
 *       nothing else off the user record. `GET /api/users/{id}` remains restricted to the
 *       user themselves and admins.
 *
 *       `total` is read from `reviewCount` rather than counted, which is what the
 *       denormalisation is for.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The seller's user ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: The seller's summary and a page of their reviews
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 seller:
 *                   type: object
 *                   properties:
 *                     id: { type: integer }
 *                     name: { type: string }
 *                     avatarUrl: { type: string, nullable: true }
 *                     reviewCount: { type: integer }
 *                     ratingSum: { type: integer }
 *                     averageRating: { type: number, nullable: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Review'
 *                       - type: object
 *                         properties:
 *                           reviewerName:
 *                             type: string
 *                             nullable: true
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *                 totalPages: { type: integer }
 *       400:
 *         description: Invalid user id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
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
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid user id", 400);

    // Projected column by column rather than `select()`. This endpoint is public and the
    // users row holds an email, a phone number and a password hash; a `select *` here is
    // one careless refactor away from publishing all three.
    const [seller] = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        reviewCount: users.reviewCount,
        ratingSum: users.ratingSum,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!seller) return jsonError("User not found", 404);

    const page = parseBoundedInt(request.nextUrl.searchParams.get("page"), {
      fallback: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const limit = parseBoundedInt(request.nextUrl.searchParams.get("limit"), {
      fallback: DEFAULT_LIMIT,
      max: MAX_LIMIT,
    });

    const rows = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        reviewerId: reviews.reviewerId,
        sellerId: reviews.sellerId,
        orderId: reviews.orderId,
        reviewerName: users.name,
      })
      .from(reviews)
      .leftJoin(users, eq(users.id, reviews.reviewerId))
      .where(eq(reviews.sellerId, id))
      // `id` as a tiebreaker: two reviews written in the same millisecond would otherwise
      // order differently between pages and one of them would be skipped.
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(limit)
      .offset((page - 1) * limit);

    return jsonOk({
      seller: { ...seller, averageRating: ratingAverage(seller) },
      data: rows,
      // From the counter, not a COUNT(*). That is what D7 bought — and it means a drift
      // between the counter and the rows shows up here as broken pagination rather than
      // as a number nobody checks.
      total: seller.reviewCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(seller.reviewCount / limit)),
    });
  } catch (err) {
    console.error("[GET /api/users/[id]/reviews]", err);
    return jsonError("Internal server error");
  }
}
