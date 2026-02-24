import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { listings, reviews } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

// ─── GET /api/listings/[id]/reviews ──────────────────────────────────────────
// Public.

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
      .where(eq(reviews.listingId, listingId))
      .orderBy(reviews.createdAt);

    return jsonOk(rows);
  } catch (err) {
    console.error("[GET /api/listings/[id]/reviews]", err);
    return jsonError("Internal server error");
  }
}

// ─── POST /api/listings/[id]/reviews ─────────────────────────────────────────
// Authenticated. Role: buyer.
// Body: { rating: number (1-5); comment?: string }

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
