import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reviews } from "@/db/schema";
import { authenticate, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

// ─── DELETE /api/reviews/[id] ─────────────────────────────────────────────────
// Authenticated. Owner (reviewer) or admin.

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid review id", 400);

    const [review] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!review) return jsonError("Review not found", 404);

    if (payload.role !== "admin" && review.reviewerId !== payload.sub) {
      return jsonError("Forbidden", 403);
    }

    await db.delete(reviews).where(eq(reviews.id, id));

    return jsonOk({ message: "Review deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/reviews/[id]]", err);
    return jsonError("Internal server error");
  }
}
