import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { listings, orderItems, orders } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";
import { parseRequest, CreateOrderSchema } from "@/lib/validation";

// ─── GET /api/orders ──────────────────────────────────────────────────────────
// Buyer   → own orders only
// Admin   → all orders
/**
 * @swagger
 * /api/orders:
 *   get:
 *     tags: [Orders]
 *     summary: List orders
 *     description: |
 *       Buyers see only their own orders. Admins see all orders.
 *       Results are sorted by creation date (newest first).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of orders
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Order'
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
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function GET(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("buyer", "admin")(payload);

    const rows = await db
      .select()
      .from(orders)
      .where(payload.role === "admin" ? undefined : eq(orders.buyerId, payload.sub))
      .orderBy(desc(orders.createdAt));

    return jsonOk(rows);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/orders]", err);
    return jsonError("Internal server error");
  }
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────
// Authenticated. Role: buyer.
// Body: { items: { listingId: number; quantity?: number }[] }
/**
 * @swagger
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Create an order
 *     description: |
 *       Creates a new order from one or more active listings.
 *       Only buyers can place orders. Total is calculated server-side.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [listingId]
 *                   properties:
 *                     listingId:
 *                       type: integer
 *                       example: 5
 *                     quantity:
 *                       type: integer
 *                       minimum: 1
 *                       default: 1
 *                       example: 1
 *     responses:
 *       201:
 *         description: Order created
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
 *                         $ref: '#/components/schemas/OrderItem'
 *       400:
 *         description: Validation error
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
 *         description: Not a buyer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Listing not found or not active
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
export async function POST(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("buyer")(payload);

    const parsed = await parseRequest(request, CreateOrderSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { items } = parsed.data;

    // ── Resolve each item ─────────────────────────────────────────────────────
    const resolvedItems: { listingId: number; quantity: number; price: string }[] = [];
    let total = 0;

    for (const { listingId, quantity: qty } of items) {
      const [listing] = await db
        .select()
        .from(listings)
        .where(and(eq(listings.id, listingId), eq(listings.status, "active")))
        .limit(1);

      if (!listing) return jsonError(`Listing ${listingId} not found or not active`, 404);

      const lineTotal = parseFloat(listing.price) * qty;
      total += lineTotal;
      resolvedItems.push({ listingId, quantity: qty, price: String(parseFloat(listing.price)) });
    }

    // ── Persist order + items in a transaction ────────────────────────────────
    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({ buyerId: payload.sub, totalPrice: String(total.toFixed(2)) })
        .returning();

      const inserted = await tx
        .insert(orderItems)
        .values(resolvedItems.map((i) => ({ ...i, orderId: order.id })))
        .returning();

      return { ...order, items: inserted };
    });

    return jsonOk(result, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[POST /api/orders]", err);
    return jsonError("Internal server error");
  }
}
