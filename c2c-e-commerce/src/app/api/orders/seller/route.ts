import { NextRequest } from "next/server";
import { count, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { coverImageIdsFor } from "@/db/listing-images";
import { listings, orders, users } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { parseBoundedInt } from "@/lib/params";
import { jsonOk, jsonError } from "@/lib/response";

/**
 * @swagger
 * /api/orders/seller:
 *   get:
 *     tags: [Orders]
 *     summary: List seller's incoming orders
 *     description: |
 *       Returns every order whose `seller_id` is the authenticated seller — the seller
 *       captured at order time, not the listing's current owner. Requires seller or
 *       admin role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Items per page (max 100)
 *     responses:
 *       200:
 *         description: Paginated seller orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       buyerId:
 *                         type: integer
 *                       sellerId:
 *                         type: integer
 *                       buyerName:
 *                         type: string
 *                       buyerEmail:
 *                         type: string
 *                       listingId:
 *                         type: integer
 *                       listingTitle:
 *                         type: string
 *                       coverImageId:
 *                         type: integer
 *                         nullable: true
 *                       price:
 *                         type: string
 *                       status:
 *                         type: string
 *                       expiresAt:
 *                         type: string
 *                         format: date-time
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
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

    const page = parseBoundedInt(request.nextUrl.searchParams.get("page"), {
      fallback: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const limit = parseBoundedInt(request.nextUrl.searchParams.get("limit"), {
      fallback: 20,
      max: 100,
    });

    const scope = payload.role === "admin" ? undefined : eq(orders.sellerId, payload.sub);

    const [{ total }] = await db.select({ total: count() }).from(orders).where(scope);

    // One query. This used to be three — every listing the seller owns, every order item
    // touching one of them, then the orders behind those items — plus a reconciliation in
    // Node. `seller_id` on the order is what D1 bought.
    const rows = await db
      .select({
        id: orders.id,
        buyerId: orders.buyerId,
        sellerId: orders.sellerId,
        listingId: orders.listingId,
        price: orders.price,
        status: orders.status,
        expiresAt: orders.expiresAt,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        buyerName: users.name,
        buyerEmail: users.email,
        listingTitle: listings.title,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.buyerId))
      .innerJoin(listings, eq(listings.id, orders.listingId))
      .where(scope)
      // `id` breaks the tie: two orders placed in the same millisecond share a
      // `created_at`, and a dashboard that reshuffles between refreshes is a bug report.
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit)
      .offset((page - 1) * limit);

    const covers = await coverImageIdsFor(rows.map((row) => row.listingId));

    const data = rows.map((row) => ({
      ...row,
      coverImageId: covers.get(row.listingId) ?? null,
    }));

    return jsonOk({ data, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/orders/seller]", err);
    return jsonError("Internal server error");
  }
}
