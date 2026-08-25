import { NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { listings, orderItems, orders } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";
import { parseRequest, CreateOrderSchema } from "@/lib/validation";

/**
 * Raised inside the order transaction so the rollback happens naturally; the
 * handler translates it into a 404. Not exported: route files may only export
 * HTTP handlers.
 */
class UnavailableListingError extends Error {
  constructor(public readonly listingId: number) {
    super(`Listing ${listingId} not found or not active`);
    this.name = "UnavailableListingError";
  }
}

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

    // ── Resolve and persist atomically ────────────────────────────────────────
    // Everything happens inside the transaction, with the listing rows locked
    // FOR UPDATE. Previously the availability check ran before the transaction
    // opened, so two buyers ordering the last of a listing could both pass the
    // "is it active" check and both have their orders accepted.
    const result = await db.transaction(async (tx) => {
      const uniqueIds = [...new Set(items.map((i) => i.listingId))];

      // One query for every item instead of one per item.
      const rows = await tx
        .select()
        .from(listings)
        .where(and(inArray(listings.id, uniqueIds), eq(listings.status, "active")))
        .for("update");

      const byId = new Map(rows.map((row) => [row.id, row]));

      const missing = uniqueIds.find((id) => !byId.has(id));
      if (missing !== undefined) {
        throw new UnavailableListingError(missing);
      }

      // Money in integer cents: accumulating floats then rounding at the end
      // lets representation error reach the stored total.
      let totalCents = 0;
      const resolvedItems = items.map(({ listingId, quantity }) => {
        const listing = byId.get(listingId)!;
        const unitCents = Math.round(parseFloat(listing.price) * 100);
        totalCents += unitCents * quantity;
        return { listingId, quantity, price: String(parseFloat(listing.price)) };
      });

      const [order] = await tx
        .insert(orders)
        .values({ buyerId: payload.sub, totalPrice: (totalCents / 100).toFixed(2) })
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
    if (err instanceof UnavailableListingError) {
      return jsonError(`Listing ${err.listingId} not found or not active`, 404);
    }
    console.error("[POST /api/orders]", err);
    return jsonError("Internal server error");
  }
}
