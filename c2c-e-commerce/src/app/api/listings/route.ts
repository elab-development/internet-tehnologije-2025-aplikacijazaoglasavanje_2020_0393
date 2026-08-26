import { NextRequest } from "next/server";
import { and, asc, count, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { db } from "@/db";
import { listings, type NewListing } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import type { TokenPayload } from "@/lib/auth";
import { resolveListingVisibility } from "@/lib/listing-visibility";
import { computeListingEmbedding } from "@/lib/ai/listing-embedding";
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
 *         description: Search by title (case-insensitive contains)
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

    const { searchParams } = request.nextUrl;
    // ── Pagination ────────────────────────────────────────────────────────────
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20)
    );
    const offset = (page - 1) * limit;

    // ── Filters ───────────────────────────────────────────────────────────────
    // See lib/listing-visibility.ts — deciding this from the raw query string
    // is what previously let `?sellerId=abc` drop every filter and dump the
    // whole table to anonymous callers.
    const { includeAllStatuses, sellerFilter } = resolveListingVisibility(
      searchParams.get("sellerId"),
      payload
    );

    const conditions = includeAllStatuses
      ? []
      : [eq(listings.status, "active")];

    if (sellerFilter !== null) {
      conditions.push(eq(listings.sellerId, sellerFilter));
    }

    const categoryId = searchParams.get("categoryId");
    if (categoryId) {
      const id = parseInt(categoryId, 10);
      if (!isNaN(id)) conditions.push(eq(listings.categoryId, id));
    }

    const minPrice = searchParams.get("minPrice");
    if (minPrice) {
      const val = parseFloat(minPrice);
      if (!isNaN(val)) conditions.push(gte(listings.price, String(val)));
    }

    const maxPrice = searchParams.get("maxPrice");
    if (maxPrice) {
      const val = parseFloat(maxPrice);
      if (!isNaN(val)) conditions.push(lte(listings.price, String(val)));
    }

    const search = searchParams.get("search");
    if (search?.trim()) conditions.push(ilike(listings.title, `%${search.trim()}%`));

    // ── Sorting ───────────────────────────────────────────────────────────────
    const sortParam = searchParams.get("sort") ?? "newest";
    const orderBy =
      sortParam === "oldest"
        ? asc(listings.createdAt)
        : sortParam === "price_asc"
          ? asc(listings.price)
          : sortParam === "price_desc"
            ? desc(listings.price)
            : desc(listings.createdAt); // default: newest

    const where = and(...conditions);

    // ── Queries ───────────────────────────────────────────────────────────────
    const [data, [{ total }]] = await Promise.all([
      db.select().from(listings).where(where).orderBy(orderBy).limit(limit).offset(offset),
      db.select({ total: count() }).from(listings).where(where),
    ]);

    return jsonOk({
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
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

    const newListing: NewListing = {
      title,
      description,
      price: String(price),
      imageUrl: imageUrl ?? null,
      sellerId: payload.sub,
      ...(categoryId !== undefined && categoryId !== null && { categoryId }),
      ...(outcome.status === "embedded" && {
        embedding: outcome.embedding,
        embeddingUpdatedAt: new Date(),
      }),
    };

    const [created] = await db.insert(listings).values(newListing).returning();

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
