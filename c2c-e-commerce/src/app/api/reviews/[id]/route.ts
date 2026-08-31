import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applyRatingDelta } from "@/db/reviews";
import { reviews } from "@/db/schema";
import { canMutateReview } from "@/lib/authorization";
import { authenticate, AuthError } from "@/lib/middleware";
import { deleteDelta, updateDelta } from "@/lib/reviews";
import { jsonOk, jsonError } from "@/lib/response";
import { parseResourceId } from "@/lib/params";
import { parseRequest, UpdateReviewSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };


// ─── PATCH /api/reviews/[id] ──────────────────────────────────────────────────
// Authenticated. Author or admin. Both fields optional, at least one required.

/**
 * @swagger
 * /api/reviews/{id}:
 *   patch:
 *     tags: [Reviews]
 *     summary: Edit a review
 *     description: |
 *       Changes the rating, the comment, or both. Only the author or an admin may edit —
 *       deliberately **not** the seller being reviewed, which is the one edit that would
 *       make the ratings worthless.
 *
 *       A changed rating moves the seller's `ratingSum` in the same transaction and leaves
 *       `reviewCount` alone: it is still one review.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Review ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 4
 *               comment:
 *                 type: string
 *                 nullable: true
 *                 example: Revised after a second look.
 *     responses:
 *       200:
 *         description: The updated review
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Review'
 *       400:
 *         description: Invalid review id, or no updatable fields
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
 *         description: Not the author or an admin
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
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid review id", 400);

    const [review] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!review) return jsonError("Review not found", 404);

    // 403 rather than 404: a review is a public object, readable by anyone through
    // `GET /api/users/{id}/reviews`, so hiding its existence would protect nothing.
    if (!canMutateReview(payload, review)) {
      return jsonError("Forbidden", 403);
    }

    const parsed = await parseRequest(request, UpdateReviewSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { rating, comment } = parsed.data;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(reviews)
        .set({
          ...(rating !== undefined ? { rating } : {}),
          ...(comment !== undefined ? { comment } : {}),
        })
        .where(eq(reviews.id, id))
        .returning();

      // Only the sum moves, and only when the rating actually changed. `updateDelta`
      // returns a zero delta for an unchanged rating, so the guard is an optimisation
      // rather than the correctness — but a no-op UPDATE on `users` for every comment
      // edit is a row lock nobody asked for.
      if (rating !== undefined && rating !== review.rating) {
        await applyRatingDelta(tx, review.sellerId, updateDelta(review.rating, rating));
      }

      return row;
    });

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PATCH /api/reviews/[id]]", err);
    return jsonError("Internal server error");
  }
}

// ─── DELETE /api/reviews/[id] ─────────────────────────────────────────────────
// Authenticated. Owner (reviewer) or admin.

/**
 * @swagger
 * /api/reviews/{id}:
 *   delete:
 *     tags: [Reviews]
 *     summary: Delete a review
 *     description: |
 *       Permanently removes a review. Only the reviewer or an admin can delete. The
 *       seller's `reviewCount` and `ratingSum` are adjusted in the same transaction.
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

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid review id", 400);

    const [review] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!review) return jsonError("Review not found", 404);

    // Author or admin. Deliberately not the seller being reviewed -- that is the one
    // deletion that would make the ratings worthless.
    if (!canMutateReview(payload, review)) {
      return jsonError("Forbidden", 403);
    }

    await db.transaction(async (tx) => {
      await tx.delete(reviews).where(eq(reviews.id, id));
      await applyRatingDelta(tx, review.sellerId, deleteDelta(review.rating));
    });

    return jsonOk({ message: "Review deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/reviews/[id]]", err);
    return jsonError("Internal server error");
  }
}
