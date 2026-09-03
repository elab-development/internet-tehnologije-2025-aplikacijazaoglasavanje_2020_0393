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

/**
 * Thrown inside `PATCH`'s transaction when the locked re-read finds nothing, to roll the
 * transaction back without committing anything.
 *
 * The outer read that decided authorisation can be stale by the time this transaction's
 * `FOR UPDATE` runs -- a `DELETE` may have committed in between. That is not a server
 * error: the review really is gone, and a thrown error is the only way out of a Drizzle
 * transaction that must not commit, matching how `PUT /api/orders/[id]` unwinds its own
 * transaction with `ListingNotSellableError`.
 */
class ReviewGoneError extends Error {}


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
      // Re-read and lock the row inside the transaction rather than trusting the `review`
      // fetched above. That earlier read still decides authorisation and the 404 -- that
      // ordering does not change -- but it happened before this transaction opened, so
      // two concurrent edits can both read rating 3, one set 5 (+2) and the other set 1
      // (-2), and whichever commits last wins the stored rating while the sum has moved
      // by net zero. `FOR UPDATE` makes the second edit block on the first's row lock and
      // compute its delta against what the first actually committed, so the two compose
      // instead of one silently erasing the other's contribution to the sum.
      const [current] = await tx
        .select({ rating: reviews.rating, sellerId: reviews.sellerId })
        .from(reviews)
        .where(eq(reviews.id, id))
        .for("update");

      // The outer read found the row, but a `DELETE` may have committed between that
      // read and this lock. `current` would then be `undefined` -- not a server error,
      // just a review that stopped existing while this request was in flight.
      if (!current) throw new ReviewGoneError();

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
      if (rating !== undefined && rating !== current.rating) {
        await applyRatingDelta(tx, current.sellerId, updateDelta(current.rating, rating));
      }

      return row;
    });

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    if (err instanceof ReviewGoneError) return jsonError("Review not found", 404);
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
      // The delete itself is the lock: no separate `SELECT ... FOR UPDATE` needed. Two
      // concurrent `DELETE`s of one review both used to read the outer, unlocked
      // `review.rating` and both applied a delta -- the loser matched no row but still
      // decremented the seller's totals, driving `review_count` negative. A `PATCH`
      // racing a `DELETE` had the same shape: the delete's stale read missed whatever
      // rating the edit had just committed. `RETURNING` off the `DELETE` itself fixes
      // both: only the transaction that actually removed the row gets a value back, and
      // that value carries whatever rating was last committed -- a racing PATCH's or the
      // original's.
      const [removed] = await tx
        .delete(reviews)
        .where(eq(reviews.id, id))
        .returning({ rating: reviews.rating, sellerId: reviews.sellerId });

      // Only the transaction that actually removed the row adjusts the totals. A second
      // concurrent DELETE matches nothing here, so it must not decrement anything -- and
      // the row this one removed carries whatever rating a racing PATCH had just
      // committed.
      if (removed) {
        await applyRatingDelta(tx, removed.sellerId, deleteDelta(removed.rating));
      }
    });

    return jsonOk({ message: "Review deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/reviews/[id]]", err);
    return jsonError("Internal server error");
  }
}
