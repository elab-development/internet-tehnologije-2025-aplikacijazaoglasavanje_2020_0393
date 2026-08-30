import { NextRequest } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { listings, orderItems, orders } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { RESERVATION_HOURS } from "@/lib/order-lifecycle";
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
// Body: { listingId: number }
/**
 * @swagger
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Create an order
 *     description: |
 *       Reserves one active listing. An order is one listing, so the price is the total
 *       and it is read server-side from the listing. Only buyers can place orders.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [listingId]
 *             properties:
 *               listingId:
 *                 type: integer
 *                 example: 5
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

    const { listingId } = parsed.data;

    // ── Resolve and persist atomically ────────────────────────────────────────
    // Everything happens inside the transaction, with the listing row locked
    // FOR UPDATE. Previously the availability check ran before the transaction
    // opened, so two buyers ordering the last of a listing could both pass the
    // "is it active" check and both have their orders accepted.
    const result = await db.transaction(async (tx) => {
      const [listing] = await tx
        .select()
        .from(listings)
        .where(and(eq(listings.id, listingId), eq(listings.status, "active")))
        .for("update");

      if (!listing) {
        throw new UnavailableListingError(listingId);
      }

      // With one listing per order the price is the total, so there is no longer a sum
      // to accumulate — the integer-cent arithmetic that used to guard it is gone with
      // the thing it guarded. `parseFloat` still normalises the numeric's text form.
      const price = String(parseFloat(listing.price));

      const [order] = await tx
        .insert(orders)
        .values({
          buyerId: payload.sub,
          sellerId: listing.sellerId,
          listingId,
          price,
          // Written until 0016 drops the column, so the pages that still read it keep
          // showing a figure. Task 4 stops writing it.
          totalPrice: price,
          // Postgres's clock, never Node's: the deadline and the `created_at` it is
          // measured from have to come from the same clock or the sweep misfires.
          expiresAt: sql`now() + make_interval(hours => ${RESERVATION_HOURS})`,
        })
        .returning();

      // Kept until 0016 drops the table; Task 9 removes this write with it.
      const inserted = await tx
        .insert(orderItems)
        .values({ orderId: order.id, listingId, price, quantity: 1 })
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
