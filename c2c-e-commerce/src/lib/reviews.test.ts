/**
 * Part 4 spec §6.2 and D7 — the review rules, exhaustively.
 *
 * Both halves of this file exist because they are decisions rather than queries. The old
 * eligibility rule was a hand-maintained list of order statuses (`PURCHASED_ORDER_STATUSES`)
 * that no test could contradict; this one is a predicate, and every combination of actor
 * and status is checked below.
 */
import { describe, expect, it } from "vitest";

import { ORDER_STATUSES, type OrderStatus } from "./order-lifecycle";
import {
  applyDelta,
  canReviewOrder,
  deleteDelta,
  insertDelta,
  ratingAverage,
  updateDelta,
} from "./reviews";

const BUYER = 1;
const SELLER = 2;
const STRANGER = 3;

const orderWith = (status: OrderStatus) => ({
  buyerId: BUYER,
  sellerId: SELLER,
  status,
});

describe("canReviewOrder — who may review", () => {
  it("lets the buyer review a completed order", () => {
    expect(canReviewOrder(BUYER, orderWith("completed"))).toBe(true);
  });

  it("refuses the seller of that order", () => {
    // Reviews are one-directional (D6). A seller reviewing their own sale is the whole
    // reason the predicate takes an id rather than a role.
    expect(canReviewOrder(SELLER, orderWith("completed"))).toBe(false);
  });

  it("refuses anyone who was not party to the order", () => {
    expect(canReviewOrder(STRANGER, orderWith("completed"))).toBe(false);
  });

  it("refuses the buyer on every status but completed", () => {
    for (const status of ORDER_STATUSES) {
      if (status === "completed") continue;
      expect(canReviewOrder(BUYER, orderWith(status)), status).toBe(false);
    }
  });

  it("accepts completed and nothing else, across the whole enum", () => {
    // The positive half of the sweep above, so a future status added to the enum has to
    // be considered here rather than silently inheriting `false`.
    const allowed = ORDER_STATUSES.filter((status) =>
      canReviewOrder(BUYER, orderWith(status)),
    );
    expect(allowed).toEqual(["completed"]);
  });

  it("refuses an order whose buyer and seller are the same person", () => {
    // Defensive rather than reachable: POST /api/orders refuses a self-purchase. A
    // predicate that would let someone review themselves if that guard ever slipped is
    // not one worth keeping.
    expect(
      canReviewOrder(BUYER, { buyerId: BUYER, sellerId: BUYER, status: "completed" }),
    ).toBe(false);
  });
});

describe("rating aggregates — the arithmetic (D7)", () => {
  it("an insert adds one review and its rating", () => {
    expect(insertDelta(4)).toEqual({ countDelta: 1, sumDelta: 4 });
  });

  it("an edit moves the sum and leaves the count alone", () => {
    expect(updateDelta(2, 5)).toEqual({ countDelta: 0, sumDelta: 3 });
    expect(updateDelta(5, 2)).toEqual({ countDelta: 0, sumDelta: -3 });
  });

  it("an edit to the same rating is a no-op", () => {
    expect(updateDelta(3, 3)).toEqual({ countDelta: 0, sumDelta: 0 });
  });

  it("a delete removes one review and its rating", () => {
    expect(deleteDelta(4)).toEqual({ countDelta: -1, sumDelta: -4 });
  });

  it("insert then delete returns a seller to where they started", () => {
    const start = { reviewCount: 7, ratingSum: 30 };
    const after = applyDelta(applyDelta(start, insertDelta(5)), deleteDelta(5));
    expect(after).toEqual(start);
  });

  it("survives a whole review's life: insert, edit, delete", () => {
    const start = { reviewCount: 0, ratingSum: 0 };
    const inserted = applyDelta(start, insertDelta(1));
    const edited = applyDelta(inserted, updateDelta(1, 5));
    expect(edited).toEqual({ reviewCount: 1, ratingSum: 5 });
    expect(applyDelta(edited, deleteDelta(5))).toEqual(start);
  });
});

describe("ratingAverage", () => {
  it("is the mean of the two integers", () => {
    expect(ratingAverage({ reviewCount: 4, ratingSum: 18 })).toBe(4.5);
  });

  it("is null for a seller nobody has reviewed", () => {
    // Null rather than 0: a 0 renders as five one-star reviews, which is a lie about a
    // seller who has simply never sold anything.
    expect(ratingAverage({ reviewCount: 0, ratingSum: 0 })).toBeNull();
  });

  it("is null rather than negative or infinite if the aggregates ever go wrong", () => {
    expect(ratingAverage({ reviewCount: -1, ratingSum: 5 })).toBeNull();
  });
});
