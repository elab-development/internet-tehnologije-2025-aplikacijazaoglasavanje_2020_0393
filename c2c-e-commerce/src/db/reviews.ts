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
