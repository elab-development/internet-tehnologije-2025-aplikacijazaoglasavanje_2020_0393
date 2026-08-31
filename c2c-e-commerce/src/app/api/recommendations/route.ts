import { NextRequest } from "next/server";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, inArray, isNotNull, ne, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { coverImageIdsFor } from "@/db/listing-images";
import { listings, orders, reviews } from "@/db/schema";
import {
  buildTasteVector,
  MAX_INTERACTIONS,
  type Interaction,
} from "@/lib/ai/taste-vector";
import { listingColumns } from "@/lib/listings-query";
import { authenticate, AuthError } from "@/lib/middleware";
import type { OrderStatus } from "@/lib/order-lifecycle";
import { jsonError, jsonOk } from "@/lib/response";

/** An interaction with the date the cap sorts on. `at` is why both arms select it. */
type Timed = Interaction & { at: Date };

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
        .select({
          id: listings.id,
          embedding: listings.embedding,
          at: orders.createdAt,
          status: orders.status,
        })
        .from(orders)
        .innerJoin(listings, eq(orders.listingId, listings.id))
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
        // Through the order, because that is where the listing lives now. A reviewed
        // listing is therefore always an ordered listing too, and contributes to the taste
        // vector twice — deliberately: `INTERACTION_WEIGHTS` exists to make a five-star
        // purchase count for more than a silent one.
        .innerJoin(orders, eq(orders.id, reviews.orderId))
        .innerJoin(listings, eq(listings.id, orders.listingId))
        .where(eq(reviews.reviewerId, userId))
        .orderBy(desc(reviews.createdAt))
        .limit(MAX_INTERACTIONS),
    ]);

    // One timeline before the cap, not two lists end to end. Each arm fetches up to
    // MAX_INTERACTIONS, so a concatenation is up to 100 rows and any cap over it cuts on
    // the arm boundary rather than on dates — a user with 50 reviews would lose every
    // order they ever placed, whatever its date.
    const interactions: Timed[] = [
      ...orderedRows.map<Timed>((row) => ({
        kind: "ordered",
        embedding: row.embedding,
        at: row.at,
      })),
      ...reviewedRows.map<Timed>((row) => ({
        kind: "reviewed",
        embedding: row.embedding,
        rating: row.rating,
        at: row.at,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, MAX_INTERACTIONS);

    const taste = buildTasteVector(interactions);

    // Excluded from results because the user has them or has a claim on them. A declined,
    // cancelled or expired order is the opposite: the listing went back into browse and
    // this buyer is exactly the person who wanted it. Reviewing is NOT owning either — a
    // user may well want a second one — so reviewed listings stay in the pool.
    const HOLDING: readonly OrderStatus[] = ["pending", "confirmed", "shipped", "completed"];
    const ownedIds = orderedRows
      .filter((row) => HOLDING.includes(row.status))
      .map((row) => row.id);

    // Both arms share these: never their own listings (AC4), never anything unavailable.
    const base = [
      eq(listings.status, "active"),
      ne(listings.sellerId, userId),
      ...(ownedIds.length > 0 ? [notInArray(listings.id, ownedIds)] : []),
    ];

    // `strategy` reports what actually happened. A run that built a vector and then found
    // no candidates is still personalised — it is not a cold start.
    if (!taste) {
      return jsonOk({ data: await withCovers(await popular(base, limit)), strategy: "popular" });
    }

    // Bound rather than built as a string — see listings-query.ts.
    const literal = sql`${JSON.stringify(taste)}::vector`;

    const rows = await db
      .select(listingColumns)
      .from(listings)
      .where(and(...base, isNotNull(listings.embedding)))
      .orderBy(sql`${listings.embedding} <=> ${literal}`)
      .limit(limit);

    return jsonOk({ data: await withCovers(rows), strategy: "personalised" });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[GET /api/recommendations]", err);
    return jsonError("Internal server error", 500);
  }
}

/** Attaches each row's cover image id, in the same two lines as the other list routes. */
async function withCovers<T extends { id: number }>(
  rows: T[],
): Promise<(T & { coverImageId: number | null })[]> {
  const covers = await coverImageIdsFor(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, coverImageId: covers.get(row.id) ?? null }));
}

/**
 * Cold start: the newest active listings from the most populated categories.
 *
 * Not simply the newest overall — a category with three listings and one with two hundred
 * should not shape a first impression of the marketplace equally.
 */
async function popular(base: SQL[], limit: number) {
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
    .select(listingColumns)
    .from(listings)
    .where(
      and(
        ...base,
        // A marketplace whose listings have no categories at all should still answer.
        ...(categoryIds.length > 0 ? [inArray(listings.categoryId, categoryIds)] : []),
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
