import { NextRequest } from "next/server";
import { and, desc, eq, isNotNull, ne, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { listings, orderItems, orders, reviews } from "@/db/schema";
import {
  buildTasteVector,
  MAX_INTERACTIONS,
  type Interaction,
} from "@/lib/ai/taste-vector";
import { authenticate, AuthError } from "@/lib/middleware";
import { jsonError, jsonOk } from "@/lib/response";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * @swagger
 * /api/recommendations:
 *   get:
 *     tags: [Listings]
 *     summary: Listings recommended for the authenticated user
 *     description: >
 *       Personalised from data the marketplace already has — what the user ordered and
 *       what they reviewed. No browsing or view history is tracked.
 *
 *       A user with no usable history gets the newest active listings from the most
 *       populated categories instead. The `strategy` field says which of the two happened,
 *       so a client never presents a popular list as a personal one.
 *
 *       Listings the user already ordered, their own listings, and anything not `active`
 *       are excluded from both strategies.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: How many recommendations to return
 *     responses:
 *       200:
 *         description: Recommendations, best first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Listing'
 *                 strategy:
 *                   type: string
 *                   enum: [personalised, popular]
 *                   description: >
 *                     `personalised` — ranked against a taste vector built from the user's
 *                     orders and reviews. `popular` — the cold-start fallback.
 *       401:
 *         description: Missing or invalid token
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
export async function GET(request: NextRequest) {
  try {
    const payload = authenticate(request);
    const userId = payload.sub;
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

    // One query per arm rather than one per interaction: AC9's 500 ms budget is generous,
    // but 50 interactions would otherwise be 50 round trips.
    const [orderedRows, reviewedRows] = await Promise.all([
      db
        .select({ id: listings.id, embedding: listings.embedding, at: orders.createdAt })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .innerJoin(listings, eq(orderItems.listingId, listings.id))
        .where(eq(orders.buyerId, userId))
        .orderBy(desc(orders.createdAt))
        .limit(MAX_INTERACTIONS),
      db
        .select({
          embedding: listings.embedding,
          rating: reviews.rating,
          at: reviews.createdAt,
        })
        .from(reviews)
        .innerJoin(listings, eq(reviews.listingId, listings.id))
        .where(eq(reviews.reviewerId, userId))
        .orderBy(desc(reviews.createdAt))
        .limit(MAX_INTERACTIONS),
    ]);

    const interactions: Interaction[] = [
      ...orderedRows.map<Interaction>((row) => ({
        kind: "ordered",
        embedding: row.embedding,
      })),
      ...reviewedRows.map<Interaction>((row) => ({
        kind: "reviewed",
        embedding: row.embedding,
        rating: row.rating,
      })),
    ];

    const taste = buildTasteVector(interactions);

    // Excluded from results because the user owns them already. Reviewing is NOT owning —
    // a user may well want a second one — so reviewed listings stay in the pool.
    const ownedIds = orderedRows.map((row) => row.id);

    // Both arms share these: never their own listings (AC4), never anything unavailable.
    const base = [
      eq(listings.status, "active"),
      ne(listings.sellerId, userId),
      ...(ownedIds.length > 0 ? [notInArray(listings.id, ownedIds)] : []),
    ];

    // `strategy` reports what actually happened. A run that built a vector and then found
    // no candidates is still personalised — it is not a cold start.
    if (!taste) {
      return jsonOk({ data: await popular(base, limit), strategy: "popular" });
    }

    const literal = sql.raw(`'[${taste.join(",")}]'::vector`);

    const data = await db
      .select()
      .from(listings)
      .where(and(...base, isNotNull(listings.embedding)))
      .orderBy(sql`${listings.embedding} <=> ${literal}`)
      .limit(limit);

    return jsonOk({ data, strategy: "personalised" });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[GET /api/recommendations]", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * Cold start: the newest active listings from the most populated categories.
 *
 * Not simply the newest overall — a category with three listings and one with two hundred
 * should not shape a first impression of the marketplace equally.
 */
async function popular(base: ReturnType<typeof eq>[], limit: number) {
  const busiest = await db
    .select({ categoryId: listings.categoryId, total: sql<number>`count(*)` })
    .from(listings)
    .where(and(...base, isNotNull(listings.categoryId)))
    .groupBy(listings.categoryId)
    .orderBy(desc(sql`count(*)`))
    .limit(3);

    const categoryIds = busiest
    .map((row) => row.categoryId)
    .filter((id): id is number => id !== null);

  const rows = await db
    .select()
    .from(listings)
    .where(
      and(
        ...base,
        // A marketplace whose listings have no categories at all should still answer.
        ...(categoryIds.length > 0
          ? [sql`${listings.categoryId} = ANY(${sql.raw(`ARRAY[${categoryIds.join(",")}]`)})`]
          : []),
      ),
    )
    .orderBy(desc(listings.createdAt))
    .limit(limit);

  return rows;
}

/** Explicit rather than `parseInt(raw) || DEFAULT`, which only works because 0 is falsy. */
function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, parsed);
}
