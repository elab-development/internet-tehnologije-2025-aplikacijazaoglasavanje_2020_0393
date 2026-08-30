/**
 * Part 4 of the 2026-08-30 redesign (spec §6.2, D6, D7) — the review rules, as pure
 * functions.
 *
 * Two things live here and nothing else: who may review, and what one write does to a
 * seller's denormalised reputation. Both are decisions rather than queries, so they are
 * testable without a database — which is the point. Review eligibility used to key off
 * `PURCHASED_ORDER_STATUSES`, a hand-maintained subset of the order enum kept beside the
 * code that read it. That is a comment pretending to be a rule, and it is what this file
 * replaces.
 */
import type { OrderStatus } from "./order-lifecycle";

/** The fields of an order that decide whether it can be reviewed. */
export type ReviewableOrder = {
  buyerId: number;
  sellerId: number;
  status: OrderStatus;
};

/**
 * Whether this user may review this order.
 *
 * The whole rule from spec §6.2: the caller is the buyer, and the transaction completed.
 * The spec's third clause — `orders.seller_id = subject` — is not checked here because
 * the subject is *read from* the order rather than supplied by the caller, so it cannot
 * disagree. One review per order is the unique index's job, not a predicate's: a `SELECT`
 * followed by an `INSERT` is exactly the check two concurrent posts both pass.
 *
 * An id, never a role. D5 makes every user both buyer and seller, so a role test would
 * lock a seller out of reviewing the purchase they made.
 */
export function canReviewOrder(userId: number, order: ReviewableOrder): boolean {
  // Defensive rather than reachable: `POST /api/orders` refuses a self-purchase. A
  // predicate that would let someone review themselves if that guard ever slipped is not
  // one worth keeping.
  if (order.buyerId === order.sellerId) return false;

  return order.buyerId === userId && order.status === "completed";
}

/**
 * A seller's denormalised reputation (D7).
 *
 * Two integers rather than a stored mean, so every update is exact and the average is
 * derived. A stored mean drifts the moment one write is missed, and nothing ever tells
 * you which write it was.
 */
export type RatingAggregate = { reviewCount: number; ratingSum: number };

/** What one write does to those two integers. */
export type RatingDelta = { countDelta: number; sumDelta: number };

export function insertDelta(rating: number): RatingDelta {
  return { countDelta: 1, sumDelta: rating };
}

/** An edit moves the sum and leaves the count alone — it is the same review. */
export function updateDelta(from: number, to: number): RatingDelta {
  return { countDelta: 0, sumDelta: to - from };
}

export function deleteDelta(rating: number): RatingDelta {
  return { countDelta: -1, sumDelta: -rating };
}

export function applyDelta(
  aggregate: RatingAggregate,
  delta: RatingDelta,
): RatingAggregate {
  return {
    reviewCount: aggregate.reviewCount + delta.countDelta,
    ratingSum: aggregate.ratingSum + delta.sumDelta,
  };
}

/**
 * The mean, or `null` for a seller nobody has reviewed.
 *
 * `null` rather than 0, because a 0 renders as five one-star reviews — a lie about a
 * seller who has simply never sold anything. A non-positive count is treated the same
 * way: if the aggregates have somehow gone wrong, "no rating" is a better answer than a
 * negative or infinite one.
 */
export function ratingAverage(aggregate: RatingAggregate): number | null {
  if (aggregate.reviewCount <= 0) return null;
  return aggregate.ratingSum / aggregate.reviewCount;
}
