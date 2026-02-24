import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { db } from "@/db";
import { listings, type NewListing } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";

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
 *       When `sellerId` is provided, all statuses are returned (for seller dashboard).
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
 *         description: Filter by seller ID (returns all statuses)
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
    const { searchParams } = request.nextUrl;

    // ── Pagination ────────────────────────────────────────────────────────────
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20)
    );
    const offset = (page - 1) * limit;

    // ── Filters ───────────────────────────────────────────────────────────────
    const sellerId = searchParams.get("sellerId");

    // When a sellerId is provided, return all listings (including sold/removed)
    // so sellers can manage their own inventory. Otherwise only show active.
    const conditions = sellerId
      ? []
      : [eq(listings.status, "active")];

    const categoryId = searchParams.get("categoryId");
    if (categoryId) {
      const id = parseInt(categoryId, 10);
      if (!isNaN(id)) conditions.push(eq(listings.categoryId, id));
    }

    if (sellerId) {
      const id = parseInt(sellerId, 10);
      if (!isNaN(id)) conditions.push(eq(listings.sellerId, id));
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

    return NextResponse.json({
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[GET /api/listings]", err);
    return NextResponse.json({ error: "Internal server error", status: 500 }, { status: 500 });
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

    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body", status: 400 }, { status: 400 });
    }

    const { title, description, price, imageUrl, categoryId } = body as Record<string, unknown>;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required", status: 400 }, { status: 400 });
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      return NextResponse.json({ error: "description is required", status: 400 }, { status: 400 });
    }
    const priceNum = typeof price === "string" ? parseFloat(price) : typeof price === "number" ? price : NaN;
    if (isNaN(priceNum) || priceNum < 0) {
      return NextResponse.json(
        { error: "price must be a non-negative number", status: 400 },
        { status: 400 }
      );
    }

    let parsedImageUrl: string | null = null;
    if (imageUrl !== undefined && imageUrl !== null) {
      if (typeof imageUrl !== "string") {
        return NextResponse.json({ error: "imageUrl must be a string", status: 400 }, { status: 400 });
      }

      const trimmed = imageUrl.trim();
      if (trimmed) {
        try {
          const parsed = new URL(trimmed);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            return NextResponse.json(
              { error: "imageUrl must be a valid http or https URL", status: 400 },
              { status: 400 }
            );
          }
          parsedImageUrl = parsed.toString();
        } catch {
          return NextResponse.json(
            { error: "imageUrl must be a valid URL", status: 400 },
            { status: 400 }
          );
        }
      }
    }

    const newListing: NewListing = {
      title: title.trim(),
      description: description.trim(),
      price: String(priceNum),
      imageUrl: parsedImageUrl,
      sellerId: payload.sub,
      ...(categoryId !== undefined && categoryId !== null && { categoryId: Number(categoryId) }),
    };

    const [created] = await db.insert(listings).values(newListing).returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, status: err.statusCode }, { status: err.statusCode });
    }
    console.error("[POST /api/listings]", err);
    return NextResponse.json({ error: "Internal server error", status: 500 }, { status: 500 });
  }
}
