import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { applyRatingDelta, isDuplicateReviewViolation } from "@/db/reviews";
import { orders, reviews } from "@/db/schema";
import { HIDE_EXISTENCE_MESSAGE, canViewOrder } from "@/lib/authorization";
import { authenticate, AuthError } from "@/lib/middleware";
import { parseResourceId } from "@/lib/params";
import { jsonOk, jsonError } from "@/lib/response";
import { canReviewOrder, insertDelta } from "@/lib/reviews";
import { parseRequest, CreateReviewSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

// ─── POST /api/orders/[id]/review ─────────────────────────────────────────────
// The buyer on a completed order, and nobody else. No role gate: sellers buy too (D5),
// and an admin's read access to an order is not a licence to write its buyer's opinion.
// Body: { rating: number (1-5); comment?: string }

/**
 * @swagger
 * /api/orders/{id}/review:
 *   post:
 *     tags: [Reviews]
 *     summary: Review the seller on a completed order
 *     description: |
 *       Reviews are posted against the order because the order is the thing being
 *       reviewed — it is the proof that the transaction happened, and it is what makes
 *       one review per transaction enforceable.
 *
 *       Eligibility is the whole of the rule: the caller is this order's buyer and the
 *       order is `completed`. A caller who is not party to the order gets **404** rather
 *       than 403, because order ids are sequential.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Order ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 5
 *               comment:
 *                 type: string
 *                 nullable: true
 *                 example: Packed well, shipped the same day.
 *     responses:
 *       201:
 *         description: Review created; the seller's aggregates moved with it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Review'
 *       400:
 *         description: Invalid order id or body
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
 *         description: A party to the order who is not its buyer, or the order is not completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: No such order, or not the caller's
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: This order has already been reviewed
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
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);

    // 404 for "not yours", identical to "does not exist" (C2C-SEC-10 AC3). Decided before
    // the body is parsed, so a stranger cannot learn from a 400 that the order is real.
    if (!order || !canViewOrder(payload, order)) {
      return jsonError(HIDE_EXISTENCE_MESSAGE, 404);
    }

    // A party who is not the buyer — the seller, or an admin — gets 403 rather than 404:
    // they can already read this order, so there is nothing left to hide.
    if (!canReviewOrder(payload.sub, order)) {
      return jsonError("You can only review an order you completed as the buyer", 403);
    }

    const parsed = await parseRequest(request, CreateReviewSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { rating, comment } = parsed.data;

    // One transaction, because a review and the seller's totals are one act. Committing
    // them separately leaves a reputation that is wrong until the second write lands, and
    // nothing afterwards can tell you which write was missed.
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reviews)
        .values({
          reviewerId: payload.sub,
          sellerId: order.sellerId,
          orderId: order.id,
          rating,
          comment: comment ?? null,
        })
        .returning();

      await applyRatingDelta(tx, order.sellerId, insertDelta(rating));

      return row;
    });

    return jsonOk(created, 201, { Location: `/api/reviews/${created.id}` });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    // The duplicate check. A `SELECT` before the `INSERT` is exactly the check two
    // concurrent posts both pass, which is why `order_id` is unique and why this is a
    // caught violation rather than a query.
    if (isDuplicateReviewViolation(err)) {
      return jsonError("You have already reviewed this order", 409);
    }
    console.error("[POST /api/orders/[id]/review]", err);
    return jsonError("Internal server error");
  }
}
