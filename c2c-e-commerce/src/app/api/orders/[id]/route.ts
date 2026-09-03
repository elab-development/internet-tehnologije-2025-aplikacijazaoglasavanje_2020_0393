import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { coverImageIdsFor } from "@/db/listing-images";
import {
  applyListingSideEffect,
  releaseUnheldListings,
  transitionOrder,
} from "@/db/orders";
import { applyRatingDelta } from "@/db/reviews";
import { listings, orders, reviews } from "@/db/schema";
import { HIDE_EXISTENCE_MESSAGE, canViewOrder, orderActorFor } from "@/lib/authorization";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { canTransition, listingStatusAfter } from "@/lib/order-lifecycle";
import { parseResourceId } from "@/lib/params";
import { deleteDelta } from "@/lib/reviews";
import { jsonOk, jsonError } from "@/lib/response";
import { parseRequest, UpdateOrderStatusSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Thrown inside the `PUT` transaction when the listing was not in the state the
 * transition assumed, to roll the order's own status change back with it.
 *
 * A thrown error is the only way out of a Drizzle transaction that does not commit, and
 * committing here is exactly how two confirmed orders come to own one object: the order
 * moves, the listing does not, and nobody is told.
 */
class ListingNotSellableError extends Error {}


// ─── GET /api/orders/[id] ─────────────────────────────────────────────────────
// Either party to the order, or an admin.

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Get an order by ID
 *     description: |
 *       Returns a single order with the listing it reserves. Only the buyer who placed
 *       it, the seller who is selling it, or an admin can view. Anyone else receives
 *       404, not 403.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Order details with its listing's title and cover image
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Order'
 *                 - type: object
 *                   properties:
 *                     listingTitle:
 *                       type: string
 *                       example: iPhone 15 Pro
 *                     coverImageId:
 *                       type: integer
 *                       nullable: true
 *                       example: 42
 *                     reviewId:
 *                       type: integer
 *                       nullable: true
 *                       description: The review of this order, if the buyer has left one
 *       400:
 *         description: Invalid order id
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
 *       404:
 *         description: Order not found, or not one the caller is party to
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
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [row] = await db
      .select({
        order: orders,
        listingTitle: listings.title,
      })
      .from(orders)
      .leftJoin(listings, eq(listings.id, orders.listingId))
      .where(eq(orders.id, id))
      .limit(1);

    // 404 for "not yours", identical to "does not exist" (C2C-SEC-10 AC3). A 403 here
    // would confirm the order is real, and order ids are sequential.
    if (!row || !canViewOrder(payload, row.order)) {
      return jsonError(HIDE_EXISTENCE_MESSAGE, 404);
    }

    const covers = await coverImageIdsFor([row.order.listingId]);

    // Whether this order has been reviewed, so the order page can offer the affordance
    // once and not again. Sent to both parties: a review of this seller is public the
    // moment it exists, so there is nothing here the seller cannot already read.
    const [review] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.orderId, row.order.id))
      .limit(1);

    return jsonOk({
      ...row.order,
      // The FK is RESTRICT, so the join cannot miss. The fallback is for a database that
      // has been edited by hand rather than for a case the code can reach.
      listingTitle: row.listingTitle ?? `Listing #${row.order.listingId}`,
      coverImageId: covers.get(row.order.listingId) ?? null,
      reviewId: review?.id ?? null,
    });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/orders/[id]]", err);
    return jsonError("Internal server error");
  }
}

// ─── PUT /api/orders/[id] ─────────────────────────────────────────────────────
// Which transitions are available is decided by the caller's relationship to this order
// (`orderActorFor`) and the graph (`canTransition`), not by their role.

/**
 * @swagger
 * /api/orders/{id}:
 *   put:
 *     tags: [Orders]
 *     summary: Update order status
 *     description: |
 *       Moves an order through the lifecycle. Which transitions are available depends on
 *       the caller's relationship to this order, not on their role:
 *       - **Buyer**: cancel (from pending, confirmed or shipped); mark received (from shipped).
 *       - **Seller**: confirm or decline (from pending); mark shipped (from confirmed); cancel (from confirmed or shipped).
 *       - **Admin**: any legal transition.
 *
 *       Confirming marks the listing sold. Declining, cancelling or expiring returns it
 *       to browse. Anyone who is not a party to the order receives 404, not 403.
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, confirmed, shipped, completed, cancelled, declined, expired]
 *                 example: confirmed
 *     responses:
 *       200:
 *         description: Order updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Order'
 *       400:
 *         description: Validation error — malformed body, or a status outside the enum
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
 *       404:
 *         description: Order not found, or not one the caller is party to
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The transition is not legal for this caller, another party moved the order first, or the listing is no longer available to sell
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
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    // No role gate. Whether this caller may act is decided by their relationship to this
    // order, which `authorize()` cannot see.
    const payload = authenticate(request);

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);

    // Authorisation before state, and 404 rather than 403: "Only pending orders can be
    // confirmed" would tell a stranger what state someone else's purchase is in, and a
    // 403 would tell them it exists at all.
    const actor = order ? orderActorFor(payload, order) : null;
    if (!order || actor === null) return jsonError(HIDE_EXISTENCE_MESSAGE, 404);

    const parsed = await parseRequest(request, UpdateOrderStatusSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { status } = parsed.data;

    if (!canTransition(order.status, status, actor)) {
      // 409, not 400: the body parsed and the status is a real one. What is wrong is the
      // resource's current state, which is what 409 means -- and the two sibling
      // conflicts in this handler already say so.
      return jsonError(`Cannot move an order from ${order.status} to ${status}`, 409);
    }

    const nextListingStatus = listingStatusAfter(status);

    let updated;
    try {
      updated = await db.transaction(async (tx) => {
        // Only the sale itself is guarded: a lapsed order must still be declinable or
        // cancellable, or it would be stranded in a status nobody can leave.
        const row = await transitionOrder(tx, id, order.status, status, status === "confirmed");
        if (!row) return null;

        // Same transaction as the status change, per §5.3: an order that confirmed while
        // its listing stayed reserved is the inconsistency this part exists to prevent.
        if (nextListingStatus !== null) {
          const applied = await applyListingSideEffect(tx, order.listingId, nextListingStatus);

          // Selling requires the listing to still be this order's to sell. If it is not
          // — an admin removed it, or legacy data left it already `sold` under another
          // order — the compare-and-set on the order succeeded against an assumption
          // that turned out to be false, and the whole transition has to come back.
          //
          // Only this direction. Releasing a listing that is already released is
          // idempotent, and rolling a cancellation back because the listing had moved on
          // would strand the order in a status nobody can leave.
          if (nextListingStatus === "sold" && applied === 0) {
            throw new ListingNotSellableError();
          }
        }

        return row;
      });
    } catch (err) {
      if (err instanceof ListingNotSellableError) {
        return jsonError("The listing is no longer available to sell", 409);
      }
      throw err;
    }

    // Matches `POST /api/orders`'s answer when someone else got there first. The caller
    // is already established as a party to this order, so a real message leaks nothing.
    //
    // Also the answer when `requireUnexpired` refused the confirm: `transitionOrder`'s
    // compare-and-set returns the same null either way, and a lapsed order is still
    // `pending`, not "moved" -- a seller retrying a stale confirm has to be told the
    // reservation lapsed, or the message is simply untrue and they never find out why.
    if (!updated) {
      return jsonError(
        "This order has already moved to another status, or its reservation has lapsed",
        409,
      );
    }

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PUT /api/orders/[id]]", err);
    return jsonError("Internal server error");
  }
}

// ─── DELETE /api/orders/[id] ──────────────────────────────────────────────────
// Admin only.

/**
 * @swagger
 * /api/orders/{id}:
 *   delete:
 *     tags: [Orders]
 *     summary: Delete an order
 *     description: |
 *       Permanently removes an order. Admin only. A deleted pending order no longer
 *       holds its listing, so the listing is returned to browse in the same transaction.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Order deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Order deleted successfully
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Not an admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Order not found
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
    authorize("admin")(payload);

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return jsonError("Order not found", 404);

    await db.transaction(async (tx) => {
      // `reviews.order_id` is `ON DELETE CASCADE` (migration 0017), so the database would
      // remove a review of this order on its own — but silently, and without touching the
      // seller's `review_count`/`rating_sum`. Those two integers are denormalised (D7) and
      // have no source of truth but this kind of write, so the review is removed
      // explicitly, first, so its delta can be applied before the cascade would otherwise
      // do the deletion for free and unaccounted-for. This mirrors
      // `DELETE /api/reviews/[id]`, which is the route that owns this shape normally.
      const [removed] = await tx
        .delete(reviews)
        .where(eq(reviews.orderId, id))
        .returning({ rating: reviews.rating, sellerId: reviews.sellerId });

      if (removed) {
        await applyRatingDelta(tx, removed.sellerId, deleteDelta(removed.rating));
      }

      await tx.delete(orders).where(eq(orders.id, id));
      // A deleted pending order was the only thing holding its listing; without this the
      // listing stays `reserved` until the next sweep, unbuyable and for no reason.
      await releaseUnheldListings(tx, order.listingId);
    });

    return jsonOk({ message: "Order deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/orders/[id]]", err);
    return jsonError("Internal server error");
  }
}
