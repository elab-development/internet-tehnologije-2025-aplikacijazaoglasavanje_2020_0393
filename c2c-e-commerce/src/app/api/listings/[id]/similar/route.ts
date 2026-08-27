import { NextRequest } from "next/server";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { parseResourceId } from "@/lib/params";
import { jsonError, jsonOk } from "@/lib/response";

const DEFAULT_LIMIT = 6;
/** Mirrors the 100-row cap on the main listings route, scaled to a strip of cards. */
const MAX_LIMIT = 20;

/**
 * @swagger
 * /api/listings/{id}/similar:
 *   get:
 *     tags: [Listings]
 *     summary: Listings similar to this one
 *     description: >
 *       Nearest neighbours of a listing by embedding cosine distance. Public — this needs
 *       no user history at all, so it works on a visitor's first page view.
 *
 *       Only `active` listings with a computed embedding are returned, and the source
 *       listing is never among them. A listing whose own embedding has not been computed
 *       yet answers `200` with an empty array rather than an error.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The listing to find neighbours for
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 6
 *           maximum: 20
 *         description: How many neighbours to return (capped at 20)
 *       - in: query
 *         name: sameCategoryOnly
 *         schema:
 *           type: boolean
 *           default: false
 *         description: >
 *           Restrict results to the source listing's category. A source with no category
 *           returns an empty array under this filter rather than ignoring it.
 *     responses:
 *       200:
 *         description: Similar listings, most similar first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/Listing'
 *                   - type: object
 *                     properties:
 *                       similarity:
 *                         type: number
 *                         description: Cosine similarity in (0, 1]
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
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = parseResourceId(rawId);
    if (!id) return jsonError("Invalid listing id", 400);

    const [source] = await db
      .select({
        id: listings.id,
        categoryId: listings.categoryId,
        embedding: listings.embedding,
      })
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!source) return jsonError("Listing not found", 404);

    // Before any vector query: asking pgvector to order by distance from NULL fails
    // differently in every driver, and AC4 wants a plain empty array. A listing without a
    // vector is an ordinary state — AI-4 stores one whenever the embedder fails.
    if (!source.embedding) return jsonOk([]);

    const { searchParams } = request.nextUrl;
    const limit = parseLimit(searchParams.get("limit"));
    const sameCategoryOnly = searchParams.get("sameCategoryOnly") === "true";

    // Asking for the same category when the source has none cannot be satisfied. Returning
    // unfiltered results instead would hand cross-category rows to a caller who explicitly
    // asked not to have them.
    if (sameCategoryOnly && source.categoryId === null) return jsonOk([]);

    // Bound, not built as a string: interpolating into a `sql` template makes this a
    // parameter, which keeps the statement cacheable and the source row's floats out of
    // the SQL text itself.
    const literal = sql`${JSON.stringify(source.embedding)}::vector`;

    // Every exclusion is in the WHERE rather than applied afterwards, so LIMIT returns
    // that many *usable* rows — filtering later would quietly return fewer than asked for
    // whenever a neighbour happened to be sold.
    const conditions = [
      ne(listings.id, source.id),
      eq(listings.status, "active"),
      isNotNull(listings.embedding),
    ];
    if (sameCategoryOnly && source.categoryId !== null) {
      conditions.push(eq(listings.categoryId, source.categoryId));
    }

    const rows = await db
      .select({
        id: listings.id,
        title: listings.title,
        description: listings.description,
        price: listings.price,
        imageUrl: listings.imageUrl,
        status: listings.status,
        sellerId: listings.sellerId,
        categoryId: listings.categoryId,
        createdAt: listings.createdAt,
        // Spelled out rather than aliased. Postgres would accept `ORDER BY similarity`,
        // but HNSW only indexes the `<=>` operator form — ordering by `1 - (...)` gives a
        // sequential scan. Both sides repeat the distance and must stay identical.
        similarity: sql<number>`1 - (${listings.embedding} <=> ${literal})`,
      })
      .from(listings)
      .where(and(...conditions))
      .orderBy(sql`${listings.embedding} <=> ${literal}`)
      .limit(limit);

    return jsonOk(rows.map((row) => ({ ...row, similarity: Number(row.similarity) })));
  } catch (err) {
    console.error("[GET /api/listings/[id]/similar]", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * `parseInt(raw) || DEFAULT` would work by accident — it relies on 0 being falsy. Stated
 * explicitly so `limit=0` returning six is a decision rather than a coincidence.
 */
function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, parsed);
}
