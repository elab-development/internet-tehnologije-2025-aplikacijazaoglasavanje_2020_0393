import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
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
// Admin only – update order status.
// Body: { status: "pending" | "paid" | "shipped" | "completed" | "cancelled" }

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("admin")(payload);

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return jsonError("Order not found", 404);

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);

    const { status } = body as Record<string, unknown>;

    const allowed = ["pending", "paid", "shipped", "completed", "cancelled"] as const;
    if (!status || !allowed.includes(status as (typeof allowed)[number])) {
      return jsonError(`status must be one of: ${allowed.join(", ")}`, 400);
    }

    const [updated] = await db
      .update(orders)
      .set({ status: status as (typeof allowed)[number] })
      .where(eq(orders.id, id))
      .returning();

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PUT /api/orders/[id]]", err);
    return jsonError("Internal server error");
  }
}

// ─── DELETE /api/orders/[id] ──────────────────────────────────────────────────
// Admin only.

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
