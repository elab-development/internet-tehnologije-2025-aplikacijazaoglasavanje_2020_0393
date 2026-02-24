import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonError, jsonOk } from "@/lib/response";

type RouteContext = { params: Promise<{ id: string }> };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) ? null : id;
}

// ─── GET /api/listings/[id] ───────────────────────────────────────────────────
// Public. Returns a single active listing.

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);

    if (!id) {
      return jsonError(
        "Invalid listing id",
        400 );
    }

    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!listing) {
      return jsonError(
        "Invalid listing id ,Listing not found",
        404
      );
    }

    // Only active listings are publicly visible
    if (listing.status !== "active") {
      return jsonError(
        "Listing not found",
        404 
      );
    }

    return jsonOk(listing);
  } catch (err) {
    console.error("[GET /api/listings/[id]]", err);
    return jsonError("Internal server error", 500);
  }
}

// ─── PUT /api/listings/[id] ───────────────────────────────────────────────────
// Authenticated. Role: owner seller or admin.

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    const { id: rawId } = await params;
    const id = parseId(rawId);

    if (!id) {
      return jsonError("Invalid listing id",
        400
      );
    }

    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!listing) {
      return jsonError("Listing not found", 404);
    }

    // Only the owner or an admin may update
    if (payload.role !== "admin" && listing.sellerId !== payload.sub) {
      return jsonError("Forbidden", 403);
    }

    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return jsonError("Invalid request body", 400);
    }

    const { title, description, price, categoryId, status } = body as Record<string, unknown>;

    // ── Build update payload (only provided fields) ───────────────────────────
    const updates: Partial<typeof listings.$inferInsert> = {};

    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return jsonError("title must be a non-empty string", 400);
      }
      updates.title = title.trim();
    }

    if (description !== undefined) {
      if (typeof description !== "string" || !description.trim()) {
        return jsonError("description must be a non-empty string", 400);
      }
      updates.description = description.trim();
    }

    if (price !== undefined) {
      const priceNum = typeof price === "string" ? parseFloat(price) : typeof price === "number" ? price : NaN;
      if (isNaN(priceNum) || priceNum < 0) {
        return jsonError("price must be a non-negative number", 400);
      }
      updates.price = String(priceNum);
    }

    if (categoryId !== undefined) {
      updates.categoryId = categoryId === null ? null : Number(categoryId);
    }

    if (status !== undefined) {
      const allowed = ["active", "sold", "removed"] as const;
      if (!allowed.includes(status as (typeof allowed)[number])) {
        return jsonError(`status must be one of: ${allowed.join(", ")}`, 400);
      }
      updates.status = status as (typeof allowed)[number];
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("No updatable fields provided", 400);
    }

    const [updated] = await db
      .update(listings)
      .set(updates)
      .where(eq(listings.id, id))
      .returning();

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[PUT /api/listings/[id]]", err);
    return jsonError("Internal server error", 500);
  }
}

// ─── DELETE /api/listings/[id] ────────────────────────────────────────────────
// Authenticated. Role: owner seller or admin.

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    const { id: rawId } = await params;
    const id = parseId(rawId);

    if (!id) {
      return jsonError("Invalid listing id", 400);
    }

    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!listing) {
      return jsonError("Listing not found", 404);
    }

    // Only the owner or an admin may delete
    if (payload.role !== "admin" && listing.sellerId !== payload.sub) {
      return jsonError("Forbidden", 403);
    }

    await db.delete(listings).where(eq(listings.id, id));

    return jsonOk({ message: "Listing deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[DELETE /api/listings/[id]]", err);
    return jsonError("Internal server error", 500);
  }
}
