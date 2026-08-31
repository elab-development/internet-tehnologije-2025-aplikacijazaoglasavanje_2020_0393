// ─── Seller rating aggregates ─────────────────────────────────────────────────
// Part 4 of the 2026-08-30 redesign (spec §6.1, D7).
//
// `users.review_count` and `users.rating_sum` are denormalised, which means every write to
// `reviews` has a second write beside it that must land in the same transaction or the two
// disagree forever — and nothing afterwards can tell you which write was missed.
//
// The arithmetic lives in `src/lib/reviews.ts` and the SQL lives here. Routes do neither:
// they decide who may write, then hand the delta over.

import { sql } from "drizzle-orm";

import type { RatingDelta } from "@/lib/reviews";

import { type Database } from "./index";
import { isUniqueViolation } from "./pg-errors";

/**
 * Either the pool-backed client or a transaction handle.
 *
 * Every function here has to be callable inside the route's transaction: inserting a
 * review and moving the seller's totals are one act, and committing them separately is a
 * reputation that is wrong for as long as the second write is late.
 *
 * `Omit<Database, "$client">` rather than bare `Database`, for the reason `OrderExecutor`
 * gives: the test database's client is typed without `$client`, and requiring it would
 * make this type unsatisfiable from a test.
 */
export type ReviewExecutor =
  | Omit<Database, "$client">
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Moves a seller's aggregates by one write's delta.
 *
 * Relative (`x = x + n`) rather than recomputed from a `COUNT`/`SUM` over their reviews.
 * A recompute reads every review that seller has ever received on every write, and — worse
 * — two concurrent recomputes can both read the pre-insert state and one of the two writes
 * then vanishes. Postgres applies an increment against the row it has locked, so
 * overlapping writers compose.
 *
 * @returns how many user rows moved. 0 means that seller does not exist, which a caller
 *          inside a transaction may want to treat as a reason to roll back.
 */
export async function applyRatingDelta(
  x: ReviewExecutor,
  sellerId: number,
  delta: RatingDelta,
): Promise<number> {
  const result = await x.execute(sql`
    UPDATE "users"
       SET "review_count" = "review_count" + ${delta.countDelta},
           "rating_sum"   = "rating_sum"   + ${delta.sumDelta}
     WHERE "id" = ${sellerId}
     RETURNING "id"
  `);

  return result.rows.length;
}

/**
 * Repairs *other* sellers' aggregates before a user is deleted out from under their reviews.
 *
 * Deleting a user cascades three ways: the reviews they wrote (`reviewer_id`), their
 * orders on both sides, and — through those orders — the reviews anchored to them, since
 * `reviews.order_id` is also `ON DELETE CASCADE` (migration 0017). Every one of those rows
 * can belong to a review of some *other* seller, and the cascade removes it with no write
 * to that seller's `review_count`/`rating_sum` — the same silent-drift shape as
 * `DELETE /api/orders/{id}` (finding 1), just reached through a different set of foreign
 * keys.
 *
 * `r.seller_id <> userId` is the one exclusion that matters: the user being deleted is
 * going away regardless, so their own aggregates need no repair, only third parties' do.
 * Excluding it also keeps this function from correcting a seller for their own vanishing
 * reviews and then finding no row left to have corrected.
 *
 * Run this inside the same transaction as the user delete, before the user row goes —
 * the aggregate query still needs to see the reviews and orders that are about to
 * disappear with it.
 *
 * @returns how many sellers' aggregates were adjusted.
 */
export async function repairAggregatesBeforeUserDelete(
  x: ReviewExecutor,
  userId: number,
): Promise<number> {
  const result = await x.execute(sql`
    UPDATE "users" AS u
       SET "review_count" = u."review_count" - agg."cnt",
           "rating_sum"   = u."rating_sum"   - agg."total"
      FROM (
        SELECT r."seller_id", count(*) AS "cnt", sum(r."rating") AS "total"
          FROM "reviews" r
          LEFT JOIN "orders" o ON o."id" = r."order_id"
         WHERE (r."reviewer_id" = ${userId}
             OR r."seller_id"   = ${userId}
             OR o."buyer_id"    = ${userId}
             OR o."seller_id"   = ${userId})
           AND r."seller_id" <> ${userId}
         GROUP BY r."seller_id"
      ) AS agg
     WHERE u."id" = agg."seller_id"
     RETURNING u."id"
  `);

  return result.rows.length;
}

/** The unique index 0017 creates: at most one review per order. */
export const ONE_REVIEW_PER_ORDER_INDEX = "reviews_one_per_order_idx";

/**
 * Whether an error is that index refusing a second review on one transaction.
 *
 * This is the duplicate check. The old one was a `SELECT` followed by an `INSERT`, which
 * two concurrent posts both pass — spec §6.1 names it as the reason `order_id` is unique.
 * A caught violation is a 409; anything else is a 500 and should stay one.
 */
export function isDuplicateReviewViolation(err: unknown): boolean {
  return isUniqueViolation(err, ONE_REVIEW_PER_ORDER_INDEX);
}
