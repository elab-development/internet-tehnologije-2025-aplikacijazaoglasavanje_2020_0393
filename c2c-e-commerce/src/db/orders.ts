// ─── Reservation and expiry ───────────────────────────────────────────────────
// Part 3 of the 2026-08-30 redesign (spec §5.2, §5.4).
//
// Four statements. The reserve path runs all of them against one listing inside its own
// transaction; the scheduled sweep runs the first two globally. Sharing the file is what
// stops the lazy path and the sweep from drifting into two different definitions of
// "expired" — D4 says correctness lives in the lazy path, and the sweep exists only so
// listings return to browse promptly.
//
// Written as raw `sql` rather than through the query builder, for two reasons. The
// statements are the spec's, verbatim, and a reviewer should be able to read one against
// the other. And `listings.updatedAt` carries `$onUpdate`: a builder update would stamp
// it on every reservation, and `updated_at` is what the embedding backfill's staleness
// query compares against — every Buy click would queue a needless re-embed.

import { and, eq, sql } from "drizzle-orm";

import { RESERVATION_HOURS, type OrderStatus } from "@/lib/order-lifecycle";

import { type Database } from "./index";
import { orders, type Order } from "./schema";

/**
 * Either the pool-backed client or a transaction handle.
 *
 * Every function here has to be callable inside the reserve transaction: expiring a
 * stale order and claiming the listing it was holding are one atomic act, and committing
 * them separately is the double-sell in slow motion.
 *
 * `Omit<Database, "$client">` rather than bare `Database`: `drizzle()`'s return type
 * carries a `$client` handle nothing in this codebase reads, and the test database's own
 * client is typed without it (`src/test/db.ts`'s `TestDatabase`). Requiring it here would
 * make this type unsatisfiable from a test — accurate to nothing, since no caller needs
 * `$client` to run a query.
 */
export type OrderExecutor =
  | Omit<Database, "$client">
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ClaimedListing = { id: number; price: string; sellerId: number };

/**
 * `now() + 48 hours`, computed by Postgres.
 *
 * The cast is deliberate and local. Drizzle types `expiresAt` as `Date` because the
 * column is a timestamp; the value we want is an expression, not a value Node computed.
 * The container clock and the host clock disagree on this project's dev machines, and a
 * deadline set from the wrong one expires orders early or never.
 */
export function reservationDeadline(): Date {
  return sql`now() + make_interval(hours => ${RESERVATION_HOURS})` as unknown as Date;
}

/**
 * Marks every pending order past its deadline `expired`.
 *
 * @param listingId scope to one listing; omit to sweep globally.
 * @returns how many orders were expired.
 */
export async function expireStalePendingOrders(
  x: OrderExecutor,
  listingId?: number,
): Promise<number> {
  const scope = listingId === undefined ? sql`` : sql` AND "listing_id" = ${listingId}`;

  const result = await x.execute(sql`
    UPDATE "orders" SET "status" = 'expired', "updated_at" = now()
     WHERE "status" = 'pending' AND "expires_at" < now()${scope}
     RETURNING "id"
  `);

  return result.rows.length;
}

/**
 * Returns reserved listings to browse once nothing pending holds them.
 *
 * The `status = 'reserved'` clause is load-bearing: without it this republishes every
 * listing whose seller withdrew it, since a `removed` listing also has no pending order.
 *
 * @param listingId scope to one listing; omit to sweep globally.
 * @returns how many listings were released.
 */
export async function releaseUnheldListings(
  x: OrderExecutor,
  listingId?: number,
): Promise<number> {
  const scope = listingId === undefined ? sql`` : sql` AND "id" = ${listingId}`;

  const result = await x.execute(sql`
    UPDATE "listings" SET "status" = 'active'
     WHERE "status" = 'reserved'${scope}
       AND NOT EXISTS (
         SELECT 1 FROM "orders"
          WHERE "orders"."listing_id" = "listings"."id"
            AND "orders"."status" = 'pending'
       )
     RETURNING "id"
  `);

  return result.rows.length;
}

/**
 * Claims a listing for a buyer, or returns null if someone else already has it.
 *
 * This is the whole of D2. `WHERE status = 'active'` is what makes the race
 * unrepresentable: the second caller's UPDATE matches no rows, rather than waiting for a
 * lock and then succeeding against a listing that is no longer available.
 *
 * The price and seller come back from `RETURNING` so the order is priced from the
 * database's row at the instant of the claim, never from anything the client sent.
 */
export async function claimListing(
  x: OrderExecutor,
  listingId: number,
): Promise<ClaimedListing | null> {
  const result = await x.execute(sql`
    UPDATE "listings" SET "status" = 'reserved'
     WHERE "id" = ${listingId} AND "status" = 'active'
     RETURNING "id", "price", "seller_id"
  `);

  const row = result.rows[0] as
    | { id: number; price: string; seller_id: number }
    | undefined;

  return row ? { id: row.id, price: row.price, sellerId: row.seller_id } : null;
}

/**
 * Applies an order transition's effect on its listing (spec §5.3).
 *
 * Both statements are conditional on the status they expect to find, so a listing its
 * seller has since withdrawn is not dragged back into browse by an order being settled.
 *
 * @returns how many listings changed — 0 or 1. The count is the whole point of the
 * return: a conditional UPDATE that matches nothing is indistinguishable from one that
 * succeeded unless the caller is told. `PUT /api/orders/[id]` checks it on the `sold`
 * direction, where a no-op means the listing was not the caller's to sell and the order
 * must not be confirmed against it. The `active` direction is genuinely idempotent, so
 * its count is available but nothing has to read it.
 */
export async function applyListingSideEffect(
  x: OrderExecutor,
  listingId: number,
  next: "active" | "sold",
): Promise<number> {
  if (next === "sold") {
    const result = await x.execute(sql`
      UPDATE "listings" SET "status" = 'sold'
       WHERE "id" = ${listingId} AND "status" = 'reserved'
       RETURNING "id"
    `);
    return result.rows.length;
  }

  const result = await x.execute(sql`
    UPDATE "listings" SET "status" = 'active'
     WHERE "id" = ${listingId} AND "status" IN ('reserved', 'sold')
     RETURNING "id"
  `);

  return result.rows.length;
}

/**
 * Moves an order from one status to another, or returns null if it has already moved.
 *
 * Compare-and-set on the status the caller made its decision against, not just the id.
 * Between a route reading the order and writing it, another party may have driven a
 * different legal transition; without the `from` term both writes commit, and the second
 * one's listing side effect silently no-ops against a listing the first already moved —
 * leaving, for instance, a `confirmed` order beside an `active` listing anyone else can
 * reserve. That is the double-sell this part exists to make unrepresentable, reached
 * through a different door.
 *
 * The query builder rather than raw `sql`, unlike everything else in this file: the
 * reason those are raw is `listings.updatedAt`'s `$onUpdate`, which must not fire on a
 * reservation. On `orders` that stamp is exactly what a status change should record.
 */
export async function transitionOrder(
  x: OrderExecutor,
  orderId: number,
  from: OrderStatus,
  to: OrderStatus,
): Promise<Order | null> {
  const [row] = await x
    .update(orders)
    .set({ status: to })
    .where(and(eq(orders.id, orderId), eq(orders.status, from)))
    .returning();

  return row ?? null;
}
