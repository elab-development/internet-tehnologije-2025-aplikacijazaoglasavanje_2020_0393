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
    const conditions = [eq(listings.status, "active")];

    const categoryId = searchParams.get("categoryId");
    if (categoryId) {
      const id = parseInt(categoryId, 10);
      if (!isNaN(id)) conditions.push(eq(listings.categoryId, id));
    }

    const sellerId = searchParams.get("sellerId");
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

export async function POST(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body", status: 400 }, { status: 400 });
    }

    const { title, description, price, categoryId } = body as Record<string, unknown>;

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

    const newListing: NewListing = {
      title: title.trim(),
      description: description.trim(),
      price: String(priceNum),
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
