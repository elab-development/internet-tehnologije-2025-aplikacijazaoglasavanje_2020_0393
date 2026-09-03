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

import { and, eq, gt, isNull, or, sql } from "drizzle-orm";

import { RESERVATION_HOURS, type OrderStatus } from "@/lib/order-lifecycle";

import { type Database } from "./index";
import { isUniqueViolation } from "./pg-errors";
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
 * The order statuses `listingStatusAfter` (`@/lib/order-lifecycle`) maps to `'active'` —
 * `declined`, `cancelled`, `expired` — the only three transitions that release a listing
 * rather than leave it exactly as the sale left it.
 *
 * A literal, not a value computed from `listingStatusAfter` at import time: this file's
 * raw SQL is meant to be read verbatim against the spec, and importing the lifecycle
 * module's *function* here to filter with would trade that legibility for a coupling this
 * layer does not otherwise have. Kept in sync the other way instead —
 * `order-lifecycle.test.ts` imports this exported constant and asserts it equals
 * `ORDER_STATUSES.filter(s => listingStatusAfter(s) === "active")`, so the two cannot
 * drift without a fast unit test failing.
 */
export const RELEASING_ORDER_STATUSES = [
  "cancelled",
  "declined",
  "expired",
] as const satisfies readonly OrderStatus[];

/**
 * Returns reserved or sold listings to browse once no order still holds them.
 *
 * Covers both statuses a listing takes on account of an order (`reserved` for a pending
 * one, `sold` for a confirmed one) and asks the same question either way: does any order
 * against this listing still count as holding it? An order holds the listing unless its
 * status is one that *releases* it (`RELEASING_ORDER_STATUSES`, above) — so `pending`,
 * `confirmed`, `shipped` and `completed` all still hold it. `shipped` and `completed`
 * matter here specifically: `listingStatusAfter` deliberately leaves the listing `sold`
 * through both ("the listing has been sold since the confirmation"), so a query that
 * tested `status IN ('pending', 'confirmed')` for "still held" — the two an in-progress
 * sale can be found in, but not the two a *finished* one ends in — would release a
 * listing whose sale had simply completed, back onto the market. That is the double-sell
 * the 2026-08-30 redesign exists to make unrepresentable, reached by deleting the
 * completed order and letting this function "clean up" a listing that was never orphaned.
 *
 * Widening only the `status IN (...)` side of this and not the liveness test would carry
 * the same failure the other way: releasing `sold` listings without also recognising a
 * live `confirmed` order as holding one would republish a listing whose sale is still
 * standing. This is what lets `DELETE /api/orders/[id]` free a listing whose *confirmed*
 * order was deleted, not just a pending one — before this, deleting a confirmed order
 * left its listing `sold` forever, unbuyable and with no order left to explain why.
 *
 * The `status IN ('reserved', 'sold')` clause is still load-bearing on its own: without
 * it this republishes every listing whose seller withdrew it, since a `removed` listing
 * also has no order holding it.
 *
 * @param listingId scope to one listing; omit to sweep globally.
 * @returns how many listings were released.
 */
export async function releaseUnheldListings(
  x: OrderExecutor,
  listingId?: number,
): Promise<number> {
  const scope = listingId === undefined ? sql`` : sql` AND "id" = ${listingId}`;
  const releasing = sql.join(
    RELEASING_ORDER_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  );

  const result = await x.execute(sql`
    UPDATE "listings" SET "status" = 'active'
     WHERE "status" IN ('reserved', 'sold')${scope}
       AND NOT EXISTS (
         SELECT 1 FROM "orders"
          WHERE "orders"."listing_id" = "listings"."id"
            AND "orders"."status" NOT IN (${releasing})
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
 * Moves an order from one status to another, or returns null if it has already moved (or,
 * with `requireUnexpired`, if it lapsed).
 *
 * Compare-and-set on the status the caller made its decision against, not just the id.
 * Between a route reading the order and writing it, another party may have driven a
 * different legal transition; without the `from` term both writes commit, and the second
 * one's listing side effect silently no-ops against a listing the first already moved —
 * leaving, for instance, a `confirmed` order beside an `active` listing anyone else can
 * reserve. That is the double-sell this part exists to make unrepresentable, reached
 * through a different door.
 *
 * `requireUnexpired` folds "and it has not lapsed" into the same compare-and-set, so
 * whether a lapsed reservation can still be confirmed no longer depends on whether the
 * scheduled sweep happened to run first (D4). It is a parameter rather than a condition
 * this function infers from `to`, so the rule is visible at the call site rather than
 * buried here — and it must be passed only for `pending -> confirmed`: expiry blocks the
 * sale, not the tidy-up. A lapsed order that could not also be declined or cancelled
 * would be stranded in a status nobody can leave, a worse bug than the one this guards.
 * Compared against `now()` computed by Postgres, not `new Date()`, for the reason
 * `reservationDeadline` above is: the container clock and the host clock disagree on this
 * project's dev machines.
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
  requireUnexpired = false,
): Promise<Order | null> {
  const notLapsed = or(isNull(orders.expiresAt), gt(orders.expiresAt, sql`now()`));

  const [row] = await x
    .update(orders)
    .set({ status: to })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.status, from),
        ...(requireUnexpired ? [notLapsed] : []),
      ),
    )
    .returning();

  return row ?? null;
}

/** Whether any order is still counting on this listing — pending, confirmed or shipped. */
export async function hasLiveOrder(
  x: OrderExecutor,
  listingId: number,
): Promise<boolean> {
  const result = await x.execute(sql`
    SELECT 1 FROM "orders"
     WHERE "listing_id" = ${listingId}
       AND "status" IN ('pending', 'confirmed', 'shipped')
     LIMIT 1
  `);

  return result.rows.length > 0;
}

/** The partial unique index 0015 creates: at most one live order per listing. */
export const ONE_LIVE_ORDER_INDEX = "orders_one_live_per_listing_idx";

/**
 * Whether an error is that index refusing a second live order.
 *
 * The index is the last line of defence behind `claimListing`'s conditional update and the
 * listing routes' guards. Reaching it means something upstream let a listing be relisted
 * while an order still held it — a real conflict, and a 409, not the 500 an unmapped
 * constraint violation would otherwise become.
 */
export function isOneLiveOrderViolation(err: unknown): boolean {
  return isUniqueViolation(err, ONE_LIVE_ORDER_INDEX);
}
