import { sql, type SQL } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { listings, type NewListing } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import type { TokenPayload } from "@/lib/auth";
import { computeListingEmbedding } from "@/lib/ai/listing-embedding";
import { buildListingQuery, listingColumns, runListingQuery } from "@/lib/listings-query";
import { jsonOk, jsonError } from "@/lib/response";
import { parseRequest, CreateListingSchema } from "@/lib/validation";

// ─── GET /api/listings ────────────────────────────────────────────────────────
// Public. Returns paginated active listings with optional filters.
//
// Query params:
//   page        number  (default 1)
//   limit       number  (default 20, max 100)
//   categoryId  number
//   sellerId    number
//   minPrice    number
//   maxPrice    number
//   search      string  (title contains)
//   sort        "newest" | "oldest" | "price_asc" | "price_desc"  (default "newest")

/**
 * @swagger
 * /api/listings:
 *   get:
 *     tags: [Listings]
 *     summary: List listings
 *     description: |
 *       Returns paginated active listings with optional filters.
 *       When `sellerId` matches the authenticated seller (or the caller is an
 *       admin), non-active listings are included too, for the seller dashboard.
 *       All other callers only ever receive active listings.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Items per page (max 100)
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: integer
 *         description: Filter by category ID
 *       - in: query
 *         name: sellerId
 *         schema:
 *           type: integer
 *         description: >
 *           Filter by seller ID. Returns all statuses only when it is the
 *           authenticated seller's own ID; otherwise active listings only.
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *         description: Minimum price filter
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *         description: Maximum price filter
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: >
 *           Search term. In `keyword` mode it matches the title
 *           (case-insensitive contains); in `semantic` and `hybrid` mode it is
 *           embedded and compared against listing vectors.
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           enum: [keyword, semantic, hybrid]
 *           default: keyword
 *         description: >
 *           How `search` is interpreted.
 *
 *           `keyword` (default) is the original behaviour and is unchanged.
 *
 *           `semantic` embeds the query and ranks by cosine similarity,
 *           returning only matches at or above a similarity floor of 0.25.
 *           Listings whose embedding has not been computed are excluded.
 *
 *           `hybrid` runs the keyword and semantic arms independently and
 *           fuses them with reciprocal rank fusion (k = 60), so a listing
 *           matching both outranks one matching either alone. A listing with
 *           no embedding is still reachable through the keyword arm.
 *
 *           **`total` differs by mode.** In `keyword` mode it counts every row
 *           matching the filters. In `semantic` and `hybrid` mode it counts
 *           only ranked candidates — rows above the similarity floor, or the
 *           fused candidate set — so it is not the size of the table.
 *
 *           With no `search` term, `semantic` and `hybrid` behave as `keyword`:
 *           there is nothing to embed.
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [newest, oldest, price_asc, price_desc]
 *           default: newest
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Paginated listings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Listing'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *             examples:
 *               semantic:
 *                 summary: Semantic mode adds a similarity to each row
 *                 value:
 *                   data:
 *                     - id: 12
 *                       title: "Insulated parka, size L"
 *                       similarity: 0.61
 *                   total: 1
 *                   page: 1
 *                   limit: 20
 *                   totalPages: 1
 *       400:
 *         description: Invalid `mode` value
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
    // ── Authentication ────────────────────────────────────────────────────────
    // This endpoint is public, so a missing or expired token is not an error —
    // it just means the caller is anonymous. Anything that is *not* an AuthError
    // (e.g. JWT_SECRET missing) is a real fault and must not be swallowed.
    let payload: TokenPayload | null = null;
    try {
      payload = authenticate(request);
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
    }

    // Filters, visibility, mode and sorting all live in lib/listings-query.ts. The
    // visibility rules in particular are a security fix that predates this endpoint's
    // search modes — see resolveListingVisibility, and AC12's regression tests.
    const parsed = buildListingQuery(request.nextUrl.searchParams, payload);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    return jsonOk(await runListingQuery(parsed.query));
  } catch (err) {
    console.error("[GET /api/listings]", err);
    return jsonError("Internal server error", 500);
  }
}

// ─── POST /api/listings ───────────────────────────────────────────────────────
// Authenticated. Role: seller, admin.

/**
 * @swagger
 * /api/listings:
 *   post:
 *     tags: [Listings]
 *     summary: Create a listing
 *     description: Creates a new marketplace listing. Requires seller or admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description, price]
 *             properties:
 *               title:
 *                 type: string
 *                 example: iPhone 15 Pro
 *               description:
 *                 type: string
 *                 example: Brand new, sealed.
 *               price:
 *                 oneOf:
 *                   - type: number
 *                   - type: string
 *                 example: 999.99
 *               imageUrl:
 *                 type: string
 *                 nullable: true
 *                 example: https://images.unsplash.com/photo-abc
 *               categoryId:
 *                 type: integer
 *                 nullable: true
 *                 example: 2
 *     responses:
 *       201:
 *         description: Listing created
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
 *         description: Not a seller or admin
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
export async function POST(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    // ── Validation ────────────────────────────────────────────────────────────
    const parsed = await parseRequest(request, CreateListingSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { title, description, price, imageUrl, categoryId } = parsed.data;

    // Embed before the insert so the happy path is a single write. The failure cannot be
    // logged yet — AC2 wants the listing id, which does not exist until the row does — so
    // the outcome is held and reported below.
    const outcome = await computeListingEmbedding({ title, description });

    // `embeddingUpdatedAt` is stamped by Postgres rather than Node, so the field holds a
    // SQL expression that Drizzle's inferred insert type does not model. Widening one
    // property beats casting the whole object and losing the rest of the checking.
    const newListing: Omit<NewListing, "embeddingUpdatedAt"> & {
      embeddingUpdatedAt?: NewListing["embeddingUpdatedAt"] | SQL;
    } = {
      title,
      description,
      price: String(price),
      imageUrl: imageUrl ?? null,
      sellerId: payload.sub,
      ...(categoryId !== undefined && categoryId !== null && { categoryId }),
      ...(outcome.status === "embedded" && {
        embedding: outcome.embedding,
        embeddingUpdatedAt: sql`now()`,
      }),
    };

    const [created] = await db.insert(listings).values(newListing).returning(listingColumns);

    if (outcome.status === "failed") {
      // Logged once, with the id, so the row can be found again. The listing is still
      // created and still fully keyword-searchable; db:backfill-embeddings will fill the
      // vector in later.
      console.error(
        `[POST /api/listings] embedding failed for listing ${created.id}; stored without one`,
        outcome.error,
      );
    }

    return jsonOk(created, 201);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[POST /api/listings]", err);
    return jsonError("Internal server error", 500);
  }
}
