import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  claimListing,
  expireStalePendingOrders,
  releaseUnheldListings,
  reservationDeadline,
} from "@/db/orders";
import { listings, orders } from "@/db/schema";
import { authenticate, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";
import { parseRequest, CreateOrderSchema } from "@/lib/validation";

/**
 * Raised inside the reserve transaction so the rollback happens naturally; the handler
 * translates it into a 409. Not exported: route files may only export HTTP handlers.
 */
class ListingUnavailableError extends Error {
  constructor() {
    super("Listing is not available");
    this.name = "ListingUnavailableError";
  }
}

// ─── GET /api/orders ──────────────────────────────────────────────────────────
// Any authenticated caller. Own purchases; admins see every order.
/**
 * @swagger
 * /api/orders:
 *   get:
 *     tags: [Orders]
 *     summary: List the caller's purchases
 *     description: |
 *       What the caller bought, whatever role they hold — a seller's own purchases appear
 *       here, their sales appear in `/api/orders/seller`. Admins see every order.
 *       Sorted newest first.
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
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function GET(request: NextRequest) {
  try {
    // No role gate: sellers buy too (D5), and what this returns is scoped by buyer id
    // rather than by role.
    const payload = authenticate(request);

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
// Any authenticated caller except the listing's own seller.
// Body: { listingId: number }
/**
 * @swagger
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Reserve a listing
 *     description: |
 *       Claims the listing for the caller and creates a pending order priced from the
 *       listing row. The listing becomes `reserved` and the seller has 48 hours to
 *       confirm or decline before the reservation lapses.
 *
 *       Anyone signed in may buy, including sellers — but not their own listing.
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
 *         description: Order created and listing reserved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Order'
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
 *         description: The caller is the listing's seller
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: No such listing, or it was never published
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Another buyer reserved it first
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

    const parsed = await parseRequest(request, CreateOrderSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { listingId } = parsed.data;

    // Read first, only to tell the two refusals apart: a listing that was never
    // purchasable is a 404, one that someone else is holding is a 409. The read is not a
    // check — the claim below is authoritative, and `sellerId` cannot change under us.
    const [listing] = await db
      .select({ sellerId: listings.sellerId, status: listings.status })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);

    if (!listing || listing.status === "draft" || listing.status === "removed") {
      return jsonError("Listing not found or not available", 404);
    }

    // D5: everyone is both buyer and seller in a peer-to-peer marketplace, so the guard
    // is on the pair of ids rather than on the caller's role.
    if (listing.sellerId === payload.sub) {
      return jsonError("You cannot buy your own listing", 403);
    }

    const order = await db.transaction(async (tx) => {
      // D4: correctness does not wait for the sweep. Anything stale holding this listing
      // is expired and released here, in the same transaction as the claim.
      await expireStalePendingOrders(tx, listingId);
      await releaseUnheldListings(tx, listingId);

      const claimed = await claimListing(tx, listingId);
      if (!claimed) throw new ListingUnavailableError();

      const [created] = await tx
        .insert(orders)
        .values({
          buyerId: payload.sub,
          sellerId: claimed.sellerId,
          listingId: claimed.id,
          price: claimed.price,
          expiresAt: reservationDeadline(),
        })
        .returning();

      return created;
    });

    return jsonOk(order, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    if (err instanceof ListingUnavailableError) {
      return jsonError("This listing has just been reserved by another buyer", 409);
    }
    console.error("[POST /api/orders]", err);
    return jsonError("Internal server error");
  }
}
