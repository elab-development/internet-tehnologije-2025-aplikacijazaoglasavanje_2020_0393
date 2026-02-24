import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { listings, orderItems, orders } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";

// ─── GET /api/orders ──────────────────────────────────────────────────────────
// Buyer   → own orders only
// Admin   → all orders

export async function GET(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("buyer", "admin")(payload);

    const rows = await db
      .select()
      .from(orders)
      .where(payload.role === "admin" ? undefined : eq(orders.buyerId, payload.sub))
      .orderBy(orders.createdAt);

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

export async function POST(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("buyer")(payload);

    const body: unknown = await request.json();

    if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);

    const { items } = body as Record<string, unknown>;

    if (!Array.isArray(items) || items.length === 0) {
      return jsonError("items must be a non-empty array", 400);
    }

    // ── Validate & resolve each item ──────────────────────────────────────────
    const resolvedItems: { listingId: number; quantity: number; price: string }[] = [];
    let total = 0;

    for (const item of items) {
      if (!item || typeof item !== "object") return jsonError("Each item must be an object", 400);

      const { listingId, quantity } = item as Record<string, unknown>;

      if (typeof listingId !== "number" || !Number.isInteger(listingId)) {
        return jsonError("Each item must have a numeric listingId", 400);
      }

      const qty = quantity === undefined ? 1 : Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        return jsonError("quantity must be a positive integer", 400);
      }

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
