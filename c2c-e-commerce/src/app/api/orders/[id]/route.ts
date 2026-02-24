import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { listings, orderItems, orders } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

// ─── GET /api/orders/[id] ─────────────────────────────────────────────────────
// Owner buyer or admin.

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Get an order by ID
 *     description: Returns a single order with its items. Only the buyer who placed it or an admin can view.
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
 *         description: Order details with items
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Order'
 *                 - type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/OrderItem'
 *                           - type: object
 *                             properties:
 *                               listingTitle:
 *                                 type: string
 *                                 example: iPhone 15 Pro
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
 *       403:
 *         description: Forbidden
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
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("buyer", "admin")(payload);

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);

    if (!order) return jsonError("Order not found", 404);

    if (payload.role !== "admin" && order.buyerId !== payload.sub) {
      return jsonError("Forbidden", 403);
    }

    const items = await db
      .select()
      .from(orderItems)
      .leftJoin(listings, eq(listings.id, orderItems.listingId))
      .where(eq(orderItems.orderId, id));

    return jsonOk({
      ...order,
      items: items.map((row) => ({
        ...row.order_items,
        listingTitle: row.listings?.title ?? `Listing #${row.order_items.listingId}`,
      })),
    });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/orders/[id]]", err);
    return jsonError("Internal server error");
  }
}

// ─── PUT /api/orders/[id] ─────────────────────────────────────────────────────
// Admin – any status change.
// Seller – can approve/reject orders that contain their listings (only from pending).
// Body: { status: "pending" | "paid" | "shipped" | "completed" | "cancelled" | "approved" | "rejected" }

/**
 * @swagger
 * /api/orders/{id}:
 *   put:
 *     tags: [Orders]
 *     summary: Update order status
 *     description: |
 *       Updates the status of an order.
 *       - **Admin**: can change to any status.
 *       - **Seller**: can only approve/reject pending orders that contain their listings.
 *       When a seller approves, their listings in the order are marked as "sold".
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
 *                 enum: [pending, paid, shipped, completed, cancelled, approved, rejected]
 *                 example: approved
 *     responses:
 *       200:
 *         description: Order updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Order'
 *       400:
 *         description: Validation error or invalid status transition
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
 *         description: Forbidden
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
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("admin", "seller")(payload);

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return jsonError("Order not found", 404);

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);

    const { status } = body as Record<string, unknown>;

    const allowed = ["pending", "paid", "shipped", "completed", "cancelled", "approved", "rejected"] as const;
    if (!status || !allowed.includes(status as (typeof allowed)[number])) {
      return jsonError(`status must be one of: ${allowed.join(", ")}`, 400);
    }

    // Seller-specific authorization: can only approve/reject their own orders
    if (payload.role === "seller") {
      const sellerAllowed = ["approved", "rejected"] as const;
      if (!sellerAllowed.includes(status as (typeof sellerAllowed)[number])) {
        return jsonError("Sellers can only approve or reject orders", 403);
      }

      if (order.status !== "pending") {
        return jsonError("Only pending orders can be approved or rejected", 400);
      }

      // Verify the order contains at least one listing owned by the seller
      const items = await db
        .select({ listingId: orderItems.listingId })
        .from(orderItems)
        .where(eq(orderItems.orderId, id));

      const sellerListings = await db
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.sellerId, payload.sub));

      const sellerListingIds = new Set(sellerListings.map((l) => l.id));
      const hasSellerItem = items.some((i) => sellerListingIds.has(i.listingId));

      if (!hasSellerItem) {
        return jsonError("Forbidden: this order does not contain your listings", 403);
      }
    }

    const [updated] = await db
      .update(orders)
      .set({ status: status as (typeof allowed)[number] })
      .where(eq(orders.id, id))
      .returning();

    // When a seller approves an order, mark their listings in that order as "sold"
    if (status === "approved" && payload.role === "seller") {
      const items = await db
        .select({ listingId: orderItems.listingId })
        .from(orderItems)
        .where(eq(orderItems.orderId, id));

      const sellerOwnedListings = await db
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.sellerId, payload.sub));

      const sellerListingIds = new Set(sellerOwnedListings.map((l) => l.id));
      const listingIdsToMark = items
        .map((i) => i.listingId)
        .filter((lid) => sellerListingIds.has(lid));

      if (listingIdsToMark.length > 0) {
        await db
          .update(listings)
          .set({ status: "sold" })
          .where(inArray(listings.id, listingIdsToMark));
      }
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
 *     description: Permanently removes an order and its items. Admin only.
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

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return jsonError("Order not found", 404);

    await db.delete(orders).where(eq(orders.id, id));

    return jsonOk({ message: "Order deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/orders/[id]]", err);
    return jsonError("Internal server error");
  }
}
