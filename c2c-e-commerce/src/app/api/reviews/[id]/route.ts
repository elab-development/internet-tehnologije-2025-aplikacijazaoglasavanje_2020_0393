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

/**
 * @swagger
 * /api/reviews/{id}:
 *   delete:
 *     tags: [Reviews]
 *     summary: Delete a review
 *     description: Permanently removes a review. Only the reviewer or an admin can delete.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Review ID
 *     responses:
 *       200:
 *         description: Review deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Review deleted successfully
 *       400:
 *         description: Invalid review id
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
 *         description: Not the reviewer or admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Review not found
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
