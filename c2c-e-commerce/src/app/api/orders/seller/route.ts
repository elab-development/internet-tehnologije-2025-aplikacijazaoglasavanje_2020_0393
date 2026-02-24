import { NextRequest } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { listings, orderItems, orders, users } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";

// ─── GET /api/orders/seller ───────────────────────────────────────────────────
// Returns orders that contain at least one item from the authenticated seller's
// listings. Each order includes its items (only those belonging to the seller)
// and the buyer info.

/**
 * @swagger
 * /api/orders/seller:
 *   get:
 *     tags: [Orders]
 *     summary: List seller's incoming orders
 *     description: |
 *       Returns orders that contain at least one item from the authenticated seller's
 *       listings. Each order includes only the items belonging to the seller, plus
 *       the buyer's name and email. Requires seller or admin role.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of seller orders
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   buyerId:
 *                     type: integer
 *                   buyerName:
 *                     type: string
 *                   buyerEmail:
 *                     type: string
 *                   totalPrice:
 *                     type: string
 *                   status:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   items:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         listingId:
 *                           type: integer
 *                         listingTitle:
 *                           type: string
 *                         listingImageUrl:
 *                           type: string
 *                           nullable: true
 *                         quantity:
 *                           type: integer
 *                         price:
 *                           type: string
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Not a seller or admin
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
    authorize("seller", "admin")(payload);

    // 1. Get the seller's listing IDs
    const sellerListings = await db
      .select({ id: listings.id })
      .from(listings)
      .where(eq(listings.sellerId, payload.sub));

    const sellerListingIds = sellerListings.map((l) => l.id);

    if (sellerListingIds.length === 0) {
      return jsonOk([]);
    }

    // 2. Find order IDs that contain items from the seller's listings
    const relevantOrderItems = await db
      .select({
        orderId: orderItems.orderId,
        orderItemId: orderItems.id,
        listingId: orderItems.listingId,
        quantity: orderItems.quantity,
        price: orderItems.price,
        listingTitle: listings.title,
        listingImageUrl: listings.imageUrl,
      })
      .from(orderItems)
      .innerJoin(listings, eq(listings.id, orderItems.listingId))
      .where(inArray(orderItems.listingId, sellerListingIds));

    if (relevantOrderItems.length === 0) {
      return jsonOk([]);
    }

    const orderIds = [...new Set(relevantOrderItems.map((i) => i.orderId))];

    // 3. Get the orders with buyer info
    const orderRows = await db
      .select({
        id: orders.id,
        buyerId: orders.buyerId,
        totalPrice: orders.totalPrice,
        status: orders.status,
        createdAt: orders.createdAt,
        buyerName: users.name,
        buyerEmail: users.email,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.buyerId))
      .where(inArray(orders.id, orderIds))
      .orderBy(desc(orders.createdAt));

    // 4. Assemble response: each order + its items from this seller
    const result = orderRows.map((order) => ({
      id: order.id,
      buyerId: order.buyerId,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      totalPrice: order.totalPrice,
      status: order.status,
      createdAt: order.createdAt,
      items: relevantOrderItems
        .filter((i) => i.orderId === order.id)
        .map((i) => ({
          id: i.orderItemId,
          listingId: i.listingId,
          listingTitle: i.listingTitle,
          listingImageUrl: i.listingImageUrl,
          quantity: i.quantity,
          price: i.price,
        })),
    }));

    return jsonOk(result);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/orders/seller]", err);
    return jsonError("Internal server error");
  }
}
