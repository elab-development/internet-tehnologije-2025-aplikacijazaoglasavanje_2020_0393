# Seller Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move reviews off the listing and onto the seller, anchored to the order that proves the transaction, so a seller's reputation accumulates across one-off listings.

**Architecture:** `reviews.listing_id` is replaced by `seller_id` (the subject) and `order_id` (the proof, UNIQUE). Eligibility collapses to one single-table predicate — the caller is the order's buyer and the order is `completed` — and one-review-per-transaction becomes a unique index rather than a `SELECT`-then-`INSERT` check two concurrent posts can both pass. `users` gains `review_count` and `rating_sum`, two integers maintained in the same transaction as every review write, so a seller's mean is derived and exact. The migration goes in two steps, additive then destructive, so the tree compiles at every task boundary.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Drizzle ORM, PostgreSQL 16 (pgvector image), Zod 4, Vitest (projects `unit`, `integration` via Testcontainers, `component` via jsdom), Testing Library, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-30-listings-orders-reviews-categories-design.md` — §6 is this plan; §7 and §8 bind it.

## Global Constraints

- **Never point any command at `DATABASE_URL` as configured.** It is the developer's own database and these migrations are destructive to it. The integration test project manages its own throwaway containers; that is the only database any task touches.
- **D6 — reviews are buyer → seller, anchored to an order.** The order is the proof of transaction and the natural uniqueness key.
- **D7 — seller rating is denormalised as `rating_sum` + `review_count`.** Integers, so every update is exact and the mean is derived. Never store the mean.
- **D5 — sellers may buy.** No role gate anywhere in this part; every decision is over ids.
- **Spec §6.2 — eligibility is `orders.buyer_id = me AND orders.seller_id = subject AND orders.status = 'completed'`, plus the unique constraint. That is the whole rule.** No second list of "statuses that count".
- **Spec §8 — data backfills are written as SQL inside the migration**, not as a Node script, so they run in the same transaction as the DDL. Each migration carries its reasoning in comments, following the convention set by 0006–0010.
- **Every test must be able to fail.** Before claiming a test covers a guard, remove the guard, watch that named test fail, and restore it. A test that passes with the code deleted is not evidence.
- **Run the suite with `npm test`, in the foreground, no background flag, no polling.** Allow up to 900000 ms. The integration project starts a container and is slow by design.
- **404 over 403 where an id is guessable and the resource is private.** Orders are private and their ids are sequential; reviews are public objects and keep 403.
- **Authorisation is decided before state.** Fetch the row, decide access, *then* validate the body.
- Baseline before Task 1: **1397 passed / 8 skipped / 0 failed**, `npx tsc --noEmit` clean, `npm run lint` clean.

---

## Deliberate Deviations from the Spec

Five places where this plan does something the spec does not say, each on purpose.

**1. Migrations are numbered 0017 and 0018, not 0014.** Spec §8's table was written before Parts 1–3 were planned and assumed they would consume 0011–0013. They consumed 0011–0016. The contents are unchanged; only the numbers move.

**2. The re-anchor is split across two migrations.** Spec §8 describes one. 0017 is additive — it adds `seller_id`, `order_id` and the aggregates, backfills them, and makes `listing_id` nullable. 0018 drops `listing_id`. This is the shape 0015/0016 used for the orders collapse, and for the same reason: dropping a column every reader still references breaks the whole tree at once, which cost Part 1 a fix round.

**3. The backfill prefers a *completed* order, not simply the earliest.** Spec §6.5 says "`order_id` from the reviewer's earliest order for that listing". Taken literally, a buyer who cancelled an order and later completed one for the same listing would have their review anchored to the cancelled transaction — a review of something that never happened, which `canReviewOrder` would then say should not exist. The backfill orders by `(status <> 'completed', created_at, id)`, so a completed order wins and the earliest-of-any-status rule applies only when there is none.

**4. `GET /api/users/{id}/reviews` returns a `seller` envelope, not a bare array.** Spec §6.4 wants a `/users/[id]` page showing a rating summary, and §6.3 adds no endpoint to source it from. Loosening `GET /api/users/{id}` — today `isSelfOrAdmin` — to serve it would publish email, phone and role to the world. Returning `{ id, name, avatarUrl, reviewCount, ratingSum, averageRating }` beside the page of reviews publishes exactly the fields the spec's own UI asks for and nothing else.

**5. `canDeleteReview` is renamed `canMutateReview`.** Spec §6.3 gives `PATCH` and `DELETE` the same rule — author or admin. A predicate named for one of the two verbs it governs invites the next reader to write a second one.

---

## File Structure

**New:**

- `c2c-e-commerce/src/lib/reviews.ts` — the pure rules: who may review, and what one write does to a seller's two integers. No database, no Drizzle. Unit-tested exhaustively.
- `c2c-e-commerce/src/db/pg-errors.ts` — recognising a Postgres unique-violation by index name, through Drizzle's error wrapper. One home for the `.cause` knowledge that two callers need.
- `c2c-e-commerce/src/db/reviews.ts` — the aggregate write, executor-parameterised so it runs inside the caller's transaction. Mirrors `src/db/orders.ts`.
- `c2c-e-commerce/src/app/api/orders/[id]/review/route.ts` — `POST`, the only way to create a review.
- `c2c-e-commerce/src/app/api/users/[id]/reviews/route.ts` — `GET`, public and paginated.
- `c2c-e-commerce/src/app/(frontend)/users/[id]/page.tsx` — the public seller profile.
- `c2c-e-commerce/src/components/reviews/StarRating.tsx` — display-only stars, used in three places.
- `c2c-e-commerce/src/components/reviews/SellerReviews.tsx` — the review list.
- `c2c-e-commerce/src/components/reviews/SellerCard.tsx` — the seller block on a listing page.
- `c2c-e-commerce/src/components/reviews/ReviewForm.tsx` — the modal the order page opens.
- `c2c-e-commerce/src/components/reviews/index.ts` — barrel.
- `c2c-e-commerce/drizzle/0017_reviews_reanchor.sql` — additive.
- `c2c-e-commerce/drizzle/0018_drop_review_listing_id.sql` — destructive.

**Modified:**

- `c2c-e-commerce/src/db/schema/reviews.ts` — `seller_id`, `order_id`, the two indexes; `listing_id` becomes nullable, then goes.
- `c2c-e-commerce/src/db/schema/users.ts` — `reviewCount`, `ratingSum`.
- `c2c-e-commerce/src/db/schema/index.ts` — relations follow.
- `c2c-e-commerce/src/db/orders.ts` — `isOneLiveOrderViolation` delegates to `pg-errors.ts`.
- `c2c-e-commerce/src/lib/authorization.ts` — `canDeleteReview` → `canMutateReview`.
- `c2c-e-commerce/src/lib/validation.ts` — `UpdateReviewSchema`.
- `c2c-e-commerce/src/app/api/reviews/[id]/route.ts` — `PATCH` added; both verbs adjust aggregates.
- `c2c-e-commerce/src/app/api/orders/[id]/route.ts` — `GET` reports `reviewId`.
- `c2c-e-commerce/src/app/api/listings/[id]/route.ts` — `GET` reports the seller's reputation.
- `c2c-e-commerce/src/app/api/recommendations/route.ts` — the reviewed arm joins through orders.
- `c2c-e-commerce/src/app/(frontend)/listings/[id]/page.tsx` — the review block becomes a seller card.
- `c2c-e-commerce/src/app/(frontend)/orders/[id]/page.tsx` — the "Leave a review" affordance.
- `c2c-e-commerce/src/types/api.ts` — `Review`, `SellerReviewsResponse`, `SellerSummary`.
- `c2c-e-commerce/src/test/factories.ts` — `makeReview` takes an order and keeps the aggregates true.
- `c2c-e-commerce/scripts/generate-swagger.mjs` — the `Review` schema currently documents a `listingId` that is leaving and an `updatedAt` that has never existed.
- `docs/security/rbac-matrix.md`, `docs/security/threat-model.md`.

**Deleted:**

- `c2c-e-commerce/src/app/api/listings/[id]/reviews/route.ts` — spec §6.3 removes both verbs.
- `c2c-e-commerce/src/components/listings/ListingReviews.tsx` — replaced by `SellerReviews.tsx`.

---
### Task 1: The pure review rules

Everything in this task is a pure function over plain values. No database, no Drizzle, no Next.js. It runs in the `unit` project and is the foundation the routes are assembled from.

**Files:**
- Create: `c2c-e-commerce/src/lib/reviews.ts`
- Create: `c2c-e-commerce/src/lib/reviews.test.ts`
- Modify: `c2c-e-commerce/src/lib/validation.ts` (the `// ─── Reviews ───` section, after `CreateReviewSchema`)
- Modify: `c2c-e-commerce/src/lib/validation.test.ts`
- Modify: `c2c-e-commerce/src/lib/authorization.ts` (rename `canDeleteReview`)
- Modify: `c2c-e-commerce/src/lib/authorization.test.ts`
- Modify: `c2c-e-commerce/src/app/api/reviews/[id]/route.ts` (the one call site of the renamed predicate)

**Interfaces:**
- Consumes: `OrderStatus` from `@/lib/order-lifecycle`; `TokenPayload` from `@/lib/auth`; `isAdmin` from `@/lib/authorization`.
- Produces:
  - `type ReviewableOrder = { buyerId: number; sellerId: number; status: OrderStatus }`
  - `canReviewOrder(userId: number, order: ReviewableOrder): boolean`
  - `type RatingAggregate = { reviewCount: number; ratingSum: number }`
  - `type RatingDelta = { countDelta: number; sumDelta: number }`
  - `insertDelta(rating: number): RatingDelta`
  - `updateDelta(from: number, to: number): RatingDelta`
  - `deleteDelta(rating: number): RatingDelta`
  - `applyDelta(aggregate: RatingAggregate, delta: RatingDelta): RatingAggregate`
  - `ratingAverage(aggregate: RatingAggregate): number | null`
  - `UpdateReviewSchema` from `@/lib/validation`
  - `canMutateReview(actor: TokenPayload, review: { reviewerId: number }): boolean` from `@/lib/authorization`

- [ ] **Step 1: Write the failing test for the pure rules**

Create `c2c-e-commerce/src/lib/reviews.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd c2c-e-commerce && npx vitest run --project unit src/lib/reviews.test.ts`
Expected: FAIL — `Failed to resolve import "./reviews"`.

- [ ] **Step 3: Write `src/lib/reviews.ts`**

Create `c2c-e-commerce/src/lib/reviews.ts`:

```ts
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd c2c-e-commerce && npx vitest run --project unit src/lib/reviews.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Prove the eligibility test can fail**

Temporarily change `canReviewOrder`'s last line to `return order.buyerId === userId;` (dropping the status clause).

Run: `cd c2c-e-commerce && npx vitest run --project unit src/lib/reviews.test.ts`
Expected: FAIL — "refuses the buyer on every status but completed" and "accepts completed and nothing else, across the whole enum".

Restore the line. Re-run: PASS.

- [ ] **Step 6: Add `UpdateReviewSchema` to validation**

In `c2c-e-commerce/src/lib/validation.ts`, immediately after `CreateReviewSchema` in the `// ─── Reviews ───` section, add:

```ts
/**
 * A partial edit of an existing review. Both fields optional, at least one required.
 *
 * The rating transformer is `CreateReviewSchema`'s, hoisted rather than copied: two
 * copies of a bounds check drift, and this one is the difference between a `CHECK`
 * violation surfacing as a 400 and as a 500.
 */
export const UpdateReviewSchema = z
  .object({
    rating: ratingField.optional(),
    comment: z
      .union([z.string(), z.null()])
      .transform((val) => (val === null || !val.trim() ? null : val.trim()))
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No updatable fields provided",
  });
```

Then hoist the rating transformer out of `CreateReviewSchema`. Replace the existing `CreateReviewSchema` block with:

```ts
/**
 * Accepts "5" as well as 5: the handler used Number(rating) before, and this endpoint is
 * driven from Swagger/API clients rather than the UI.
 */
const ratingField = z
  .union([z.string(), z.number()])
  .transform((val, ctx) => {
    const num = Number(val);
    if (!Number.isInteger(num) || num < 1 || num > 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "rating must be an integer between 1 and 5",
      });
      return z.NEVER;
    }
    return num;
  });

export const CreateReviewSchema = z.object({
  rating: ratingField,
  // Blank comments are stored as null rather than an empty string.
  comment: z
    .union([z.string(), z.null()])
    .transform((val) => (val === null || !val.trim() ? null : val.trim()))
    .optional(),
});
```

`ratingField` must be declared before both schemas that use it.

- [ ] **Step 7: Add the validation tests**

In `c2c-e-commerce/src/lib/validation.test.ts`, find the existing `CreateReviewSchema` describe block and add a new block after it:

```ts
describe("UpdateReviewSchema", () => {
  it("accepts a rating alone", () => {
    const parsed = UpdateReviewSchema.safeParse({ rating: 4 });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ rating: 4 });
  });

  it("accepts a comment alone, trimmed", () => {
    const parsed = UpdateReviewSchema.safeParse({ comment: "  fine  " });
    expect(parsed.success && parsed.data).toEqual({ comment: "fine" });
  });

  it("treats a blank comment as clearing it", () => {
    const parsed = UpdateReviewSchema.safeParse({ comment: "   " });
    expect(parsed.success && parsed.data).toEqual({ comment: null });
  });

  it("refuses an empty body", () => {
    // Otherwise a PATCH with no fields would report success having changed nothing.
    expect(UpdateReviewSchema.safeParse({}).success).toBe(false);
  });

  it("refuses a rating outside 1-5, the same as on create", () => {
    expect(UpdateReviewSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(UpdateReviewSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(UpdateReviewSchema.safeParse({ rating: 3.5 }).success).toBe(false);
  });
});
```

Add `UpdateReviewSchema` to the file's import list from `./validation`.

- [ ] **Step 8: Rename `canDeleteReview` to `canMutateReview`**

In `c2c-e-commerce/src/lib/authorization.ts`, replace the `canDeleteReview` function with:

```ts
/**
 * Whether the caller may edit or delete a review.
 *
 * The author, or an admin moderating. Explicitly not the seller being reviewed —
 * otherwise a seller could delete criticism of themselves, which is the one deletion that
 * would make the ratings worthless. Part 4 makes that risk sharper, not softer: the
 * subject of a review is now a person rather than a listing that is about to go quiet.
 *
 * Named for both verbs it governs. `PATCH` and `DELETE` share this rule (spec §6.3), and
 * a predicate named `canDeleteReview` invites the next reader to write a second one for
 * the other verb.
 */
export function canMutateReview(
  actor: TokenPayload,
  review: { reviewerId: number },
): boolean {
  return isAdmin(actor) || actor.sub === review.reviewerId;
}
```

In `c2c-e-commerce/src/lib/authorization.test.ts`, rename the import and every use, and rename the describe block to `describe("C2C-SEC-10 AC6 / Part 4 §6.3 — canMutateReview", ...)`. Add one case to it:

```ts
  it("refuses the seller being reviewed", () => {
    // Part 4 moves the subject from a listing to a person, which makes this the rule that
    // keeps a seller from curating their own reputation.
    expect(canMutateReview(SELLER, { reviewerId: BUYER.sub })).toBe(false);
  });
```

In `c2c-e-commerce/src/app/api/reviews/[id]/route.ts`, update the import and the single call site.

- [ ] **Step 9: Run the unit project and the type checker**

Run: `cd c2c-e-commerce && npx vitest run --project unit && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 10: Run the whole suite**

Run: `cd c2c-e-commerce && npm test`
Expected: 1397 + 17 = **1414 passed**, 8 skipped, 0 failed.

- [ ] **Step 11: Commit**

```bash
git add c2c-e-commerce/src/lib/reviews.ts c2c-e-commerce/src/lib/reviews.test.ts \
        c2c-e-commerce/src/lib/validation.ts c2c-e-commerce/src/lib/validation.test.ts \
        c2c-e-commerce/src/lib/authorization.ts c2c-e-commerce/src/lib/authorization.test.ts \
        "c2c-e-commerce/src/app/api/reviews/[id]/route.ts"
git commit -m "feat(reviews): eligibility and rating arithmetic as pure functions"
```

---
### Task 2: The model moves — migration 0017, schema, factories, recommendations

This is the task where reviews stop belonging to listings. It is additive on purpose: `reviews.listing_id` survives 0017 as a nullable column nothing writes, exactly as `orders.total_price` survived 0015. Task 9 drops it. Every file below is forced by the one change; none of them can land separately without leaving the tree red.

**Files:**
- Create: `c2c-e-commerce/drizzle/0017_reviews_reanchor.sql`
- Create: `c2c-e-commerce/src/db/schema/reviews-reanchor.integration.test.ts`
- Modify: `c2c-e-commerce/src/db/schema/reviews.ts`
- Modify: `c2c-e-commerce/src/db/schema/users.ts`
- Modify: `c2c-e-commerce/src/db/schema/index.ts`
- Modify: `c2c-e-commerce/src/test/factories.ts`
- Modify: `c2c-e-commerce/src/test/harness/factories.integration.test.ts`
- Modify: `c2c-e-commerce/src/app/api/recommendations/route.ts`
- Modify: `c2c-e-commerce/src/app/api/recommendations/route.integration.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `reviews.sellerId`, `reviews.orderId` (both `integer`, `notNull`), `reviews.listingId` (now **nullable**)
  - `users.reviewCount`, `users.ratingSum` (both `integer`, `notNull`, default 0)
  - index names `reviews_one_per_order_idx` (unique, on `order_id`) and `reviews_seller_id_idx`
  - `makeReview(options: MakeReviewOptions): Promise<Review>` where
    `MakeReviewOptions = Partial<Pick<Review, "rating" | "comment">> & { reviewerId?: number; sellerId?: number; orderId?: number; listingId?: number; createdAt?: Date }`

- [ ] **Step 1: Write the migration test first**

Create `c2c-e-commerce/src/db/schema/reviews-reanchor.integration.test.ts`:

```ts
/**
 * Part 4 spec §6.5 — the 0017 backfill, replayed on a database that has never seen it.
 *
 * The shared test database arrives fully migrated, so it cannot show what the migration
 * *did*. This starts its own container, applies 0000-0016, writes the pre-migration data
 * that matters, and then applies 0017 alone.
 *
 * The second of two tests in the suite that start their own container (the other is
 * `orders-collapse.integration.test.ts`). That cost buys the thing a data migration that
 * deletes rows needs and nothing else provides: evidence about which rows it deletes.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_DB_IMAGE } from "@/test/db";

const MIGRATIONS = path.resolve(__dirname, "../../../drizzle");

const REANCHOR = "0017_reviews_reanchor.sql";
const PREVIOUS = "0016_drop_order_items.sql";

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Applies one migration file: split on the breakpoint marker, run it in a transaction. */
async function apply(client: Client, file: string): Promise<void> {
  const contents = readFileSync(path.join(MIGRATIONS, file), "utf8");
  const statements = contents
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)+$/.test(s));

  await client.query("BEGIN");
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`${file} failed: ${(err as Error).message}`);
  }
}

let container: StartedPostgreSqlContainer;
let client: Client;

/** Ids the assertions read back, captured while writing the pre-migration fixture. */
const ids = {
  buyer: 0,
  otherBuyer: 0,
  seller: 0,
  listing: 0,
  secondListing: 0,
  cancelledOrder: 0,
  completedOrder: 0,
  otherBuyerOrder: 0,
  plainReview: 0,
  duplicateKeeper: 0,
  duplicateLoser: 0,
  orphanReview: 0,
  otherBuyerReview: 0,
};

beforeAll(async () => {
  container = await new PostgreSqlContainer(TEST_DB_IMAGE).start();
  client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();

  // Everything up to and including 0016 — the database as it stood before this part.
  for (const file of migrationFiles()) {
    await apply(client, file);
    if (file === PREVIOUS) break;
  }

  const one = async (sql: string, params: unknown[] = []): Promise<number> => {
    const result = await client.query(sql, params);
    return result.rows[0].id as number;
  };

  ids.seller = await one(
    `INSERT INTO users (email, name, password_hash) VALUES ('seller@t.test', 'Seller', 'x') RETURNING id`,
  );
  ids.buyer = await one(
    `INSERT INTO users (email, name, password_hash) VALUES ('buyer@t.test', 'Buyer', 'x') RETURNING id`,
  );
  ids.otherBuyer = await one(
    `INSERT INTO users (email, name, password_hash) VALUES ('other@t.test', 'Other', 'x') RETURNING id`,
  );

  ids.listing = await one(
    `INSERT INTO listings (title, description, price, seller_id, status)
     VALUES ('Sofa', 'A sofa', '100.00', $1, 'sold') RETURNING id`,
    [ids.seller],
  );
  ids.secondListing = await one(
    `INSERT INTO listings (title, description, price, seller_id, status)
     VALUES ('Lamp', 'A lamp', '20.00', $1, 'sold') RETURNING id`,
    [ids.seller],
  );

  const order = async (
    buyer: number,
    listing: number,
    status: string,
    createdAt: string,
  ): Promise<number> =>
    one(
      `INSERT INTO orders (buyer_id, seller_id, listing_id, price, status, expires_at, created_at)
       VALUES ($1, $2, $3, '100.00', $4, now() + interval '48 hours', $5) RETURNING id`,
      [buyer, ids.seller, listing, status, createdAt],
    );

  // The buyer cancelled first and completed later. The backfill must anchor their review
  // to the completed one, not to the earlier cancelled one.
  ids.cancelledOrder = await order(ids.buyer, ids.listing, "cancelled", "2026-01-01");
  ids.completedOrder = await order(ids.buyer, ids.listing, "completed", "2026-02-01");
  ids.otherBuyerOrder = await order(ids.otherBuyer, ids.secondListing, "completed", "2026-03-01");

  const review = async (
    reviewer: number,
    listing: number,
    rating: number,
    createdAt: string,
  ): Promise<number> =>
    one(
      `INSERT INTO reviews (reviewer_id, listing_id, rating, comment, created_at)
       VALUES ($1, $2, $3, 'ok', $4) RETURNING id`,
      [reviewer, listing, rating, createdAt],
    );

  // Two reviews by one buyer for one listing: the old duplicate check was a SELECT then
  // an INSERT, so two concurrent posts could both land. Only the earliest may survive.
  ids.duplicateKeeper = await review(ids.buyer, ids.listing, 4, "2026-02-02");
  ids.duplicateLoser = await review(ids.buyer, ids.listing, 1, "2026-02-03");
  ids.plainReview = ids.duplicateKeeper;

  ids.otherBuyerReview = await review(ids.otherBuyer, ids.secondListing, 5, "2026-03-02");

  // A review with no order behind it at all. Under the old eligibility rule none should
  // exist; seed and hand-edited data may disagree (spec §6.5).
  const orphanListing = await one(
    `INSERT INTO listings (title, description, price, seller_id, status)
     VALUES ('Ghost', 'No orders', '5.00', $1, 'active') RETURNING id`,
    [ids.seller],
  );
  ids.orphanReview = await review(ids.otherBuyer, orphanListing, 2, "2026-03-03");

  await apply(client, REANCHOR);
}, 180_000);

afterAll(async () => {
  await client?.end();
  await container?.stop();
});

describe("0017 — re-anchoring reviews to orders", () => {
  it("anchors a review to the reviewer's completed order, not their earliest one", async () => {
    const { rows } = await client.query(
      `SELECT order_id, seller_id FROM reviews WHERE id = $1`,
      [ids.duplicateKeeper],
    );

    expect(rows[0].order_id).toBe(ids.completedOrder);
    expect(rows[0].seller_id).toBe(ids.seller);
  });

  it("keeps the earliest of two reviews that map to one order and deletes the rest", async () => {
    const { rows } = await client.query(`SELECT id FROM reviews WHERE id = ANY($1)`, [
      [ids.duplicateKeeper, ids.duplicateLoser],
    ]);

    expect(rows.map((r) => r.id)).toEqual([ids.duplicateKeeper]);
  });

  it("deletes a review with no matching order", async () => {
    const { rowCount } = await client.query(`SELECT 1 FROM reviews WHERE id = $1`, [
      ids.orphanReview,
    ]);

    expect(rowCount).toBe(0);
  });

  it("leaves a second reviewer's review on its own order", async () => {
    const { rows } = await client.query(`SELECT order_id FROM reviews WHERE id = $1`, [
      ids.otherBuyerReview,
    ]);

    expect(rows[0].order_id).toBe(ids.otherBuyerOrder);
  });

  it("backfills the seller's aggregates from the surviving reviews", async () => {
    // 4 from the surviving duplicate and 5 from the other buyer; the 1 and the 2 were
    // deleted. A stored mean could not be checked this way — that is D7's point.
    const { rows } = await client.query(
      `SELECT review_count, rating_sum FROM users WHERE id = $1`,
      [ids.seller],
    );

    expect(rows[0].review_count).toBe(2);
    expect(rows[0].rating_sum).toBe(9);
  });

  it("leaves a user with no reviews at zero rather than null", async () => {
    const { rows } = await client.query(
      `SELECT review_count, rating_sum FROM users WHERE id = $1`,
      [ids.buyer],
    );

    expect(rows[0].review_count).toBe(0);
    expect(rows[0].rating_sum).toBe(0);
  });

  it("refuses a second review on an order that already has one", async () => {
    // The whole point of the re-anchor: one review per transaction is structural now, not
    // a SELECT two concurrent posts both pass.
    await expect(
      client.query(
        `INSERT INTO reviews (reviewer_id, seller_id, order_id, rating) VALUES ($1, $2, $3, 5)`,
        [ids.buyer, ids.seller, ids.completedOrder],
      ),
    ).rejects.toThrow(/reviews_one_per_order_idx/);
  });

  it("still has listing_id, now nullable, for 0018 to drop", async () => {
    const { rows } = await client.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'reviews' AND column_name = 'listing_id'`,
    );

    expect(rows[0].is_nullable).toBe("YES");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd c2c-e-commerce && npx vitest run --project integration src/db/schema/reviews-reanchor.integration.test.ts`
Expected: FAIL in `beforeAll` — `0017_reviews_reanchor.sql` does not exist, so `apply` throws `ENOENT`.

- [ ] **Step 3: Write the migration**

Create `c2c-e-commerce/drizzle/0017_reviews_reanchor.sql`:

```sql
-- Part 4 of the 2026-08-30 redesign — reviews are about the seller, not the listing (D6).
--
-- A review attached to a listing is stranded the moment that listing sells, which for
-- one-off second-hand goods is immediately. Anchoring it to the order moves the subject
-- to the person and makes the transaction the uniqueness key.
--
-- ADDITIVE ON PURPOSE. `reviews.listing_id` survives this migration, nullable and
-- unwritten, so the tree keeps compiling while each consumer moves to `order_id`. 0018
-- drops it. Dropping it here would break every reader at once — the defect that cost
-- Part 1 a fix round.
--
-- PARTLY REVERSIBLE (spec §8). `listing_id` is derivable back through the order, but the
-- deletions below are not: a review with no order behind it has nothing to attach to in
-- the new model.

ALTER TABLE "users"
  ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "rating_sum" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "reviews"
  ADD COLUMN "seller_id" integer,
  ADD COLUMN "order_id" integer;
--> statement-breakpoint
-- The subject comes from the listing that was reviewed.
UPDATE "reviews" AS r
   SET "seller_id" = l."seller_id"
  FROM "listings" AS l
 WHERE l."id" = r."listing_id";
--> statement-breakpoint
-- The transaction comes from the reviewer's own order for that listing.
--
-- Spec §6.5 says "earliest". Taken literally, a buyer who cancelled once and completed
-- later would have their review anchored to the cancelled transaction — a review of
-- something that never happened, which the new eligibility rule would then say should not
-- exist. Ordering by `status <> 'completed'` first puts a completed order ahead of every
-- other, and the spec's earliest-wins rule decides the rest.
UPDATE "reviews" AS r
   SET "order_id" = o."id"
  FROM (
    SELECT DISTINCT ON ("buyer_id", "listing_id")
           "id", "buyer_id", "listing_id"
      FROM "orders"
     ORDER BY "buyer_id", "listing_id", ("status" <> 'completed'), "created_at", "id"
  ) AS o
 WHERE o."buyer_id" = r."reviewer_id"
   AND o."listing_id" = r."listing_id";
--> statement-breakpoint
-- Two reviews by one buyer of one listing map to the same order, and a unique index
-- cannot hold both. The old duplicate check was a SELECT followed by an INSERT, which is
-- exactly the check two concurrent posts both pass — so this is not hypothetical. Keep
-- the earliest; it is the one the buyer wrote first.
DELETE FROM "reviews" AS r
 USING "reviews" AS other
 WHERE r."order_id" IS NOT NULL
   AND other."order_id" = r."order_id"
   AND (other."created_at", other."id") < (r."created_at", r."id");
--> statement-breakpoint
-- Anything still unanchored has no order behind it. Announce the count rather than
-- dropping rows in silence (spec §6.5).
DO $$
DECLARE orphaned integer;
BEGIN
  SELECT count(*) INTO orphaned
    FROM "reviews"
   WHERE "order_id" IS NULL OR "seller_id" IS NULL;

  IF orphaned > 0 THEN
    RAISE NOTICE '0017: deleting % review(s) with no matching order', orphaned;
  END IF;
END $$;
--> statement-breakpoint
DELETE FROM "reviews" WHERE "order_id" IS NULL OR "seller_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "reviews"
  ALTER COLUMN "seller_id" SET NOT NULL,
  ALTER COLUMN "order_id" SET NOT NULL,
  -- Nullable from here on. Nothing writes it; 0018 removes it.
  ALTER COLUMN "listing_id" DROP NOT NULL;
--> statement-breakpoint
-- CASCADE on both, matching `reviews_reviewer_id_users_id_fk`: deleting a user or an
-- order takes the reviews that describe it. The RBAC matrix records this as a known,
-- deferred consequence of `DELETE /api/users/{id}`.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_seller_id_users_id_fk"
    FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  ADD CONSTRAINT "reviews_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade;
--> statement-breakpoint
-- One review per transaction, structurally. This is the constraint the whole re-anchor is
-- for: the API's duplicate check can now be a caught violation rather than a race.
CREATE UNIQUE INDEX "reviews_one_per_order_idx" ON "reviews" ("order_id");
--> statement-breakpoint
-- `GET /api/users/{id}/reviews` is the one read that matters here and it filters on this.
CREATE INDEX "reviews_seller_id_idx" ON "reviews" ("seller_id");
--> statement-breakpoint
-- Derived once here, maintained by every write afterwards (D7). In SQL rather than a Node
-- script so it shares the transaction with the column that makes it possible (spec §8).
UPDATE "users" AS u
   SET "review_count" = agg."count",
       "rating_sum"   = agg."sum"
  FROM (
    SELECT "seller_id", count(*) AS "count", sum("rating") AS "sum"
      FROM "reviews"
     GROUP BY "seller_id"
  ) AS agg
 WHERE agg."seller_id" = u."id";
```

- [ ] **Step 4: Run the migration test and watch it pass**

Run: `cd c2c-e-commerce && npx vitest run --project integration src/db/schema/reviews-reanchor.integration.test.ts`
Expected: PASS, 8 tests.

If the run reports a Drizzle journal mismatch, note that this test reads `drizzle/*.sql` off disk directly and does not consult `drizzle/meta`. Do not hand-edit `drizzle/meta`.

- [ ] **Step 5: Prove the duplicate-deletion test can fail**

Temporarily comment out the `DELETE FROM "reviews" AS r USING "reviews" AS other …` statement.

Run: `cd c2c-e-commerce && npx vitest run --project integration src/db/schema/reviews-reanchor.integration.test.ts`
Expected: FAIL in `beforeAll` — `CREATE UNIQUE INDEX "reviews_one_per_order_idx"` cannot be created with two rows on one order. That failure *is* the evidence: without the deletion the index does not exist, so nothing later in the migration is reachable.

Restore the statement. Re-run: PASS.

- [ ] **Step 6: Update the schema files**

Replace `c2c-e-commerce/src/db/schema/reviews.ts` with:

```ts
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { listings } from "./listings";
import { orders } from "./orders";
import { users } from "./users";

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    reviewerId: integer("reviewer_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /**
     * The subject of the review (D6).
     *
     * Denormalised from the order rather than reached through it, for the same reason
     * `orders.seller_id` is: a seller's reviews become one indexed read instead of a
     * two-table join, and a later listing edit cannot retroactively change who was
     * reviewed.
     */
    sellerId: integer("seller_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /** The transaction the review is about, and the uniqueness key: one review per order. */
    orderId: integer("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    /**
     * Nullable and unwritten since 0017; 0018 drops it. The listing is reachable through
     * the order now.
     */
    listingId: integer("listing_id").references(() => listings.id, {
      onDelete: "cascade",
    }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check("rating_range", sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
    uniqueIndex("reviews_one_per_order_idx").on(table.orderId),
    index("reviews_seller_id_idx").on(table.sellerId),
  ]
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
```

In `c2c-e-commerce/src/db/schema/users.ts`, add two columns after `avatarUrl`:

```ts
  /**
   * Denormalised reputation (D7). Two integers, so every update is exact and the mean is
   * derived — a stored average drifts the moment one write is missed, and nothing ever
   * tells you which write it was. Maintained in the same transaction as every review
   * write; see `src/db/reviews.ts`.
   */
  reviewCount: integer("review_count").default(0).notNull(),
  ratingSum: integer("rating_sum").default(0).notNull(),
```

Add `integer` to the `drizzle-orm/pg-core` import list in that file.

In `c2c-e-commerce/src/db/schema/index.ts`, replace `reviewsRelations` with:

```ts
export const reviewsRelations = relations(reviews, ({ one }) => ({
  reviewer: one(users, {
    fields: [reviews.reviewerId],
    references: [users.id],
  }),
  seller: one(users, {
    fields: [reviews.sellerId],
    references: [users.id],
  }),
  order: one(orders, {
    fields: [reviews.orderId],
    references: [orders.id],
  }),
}));
```

and drop `reviews: many(reviews)` from `listingsRelations` — a listing no longer has reviews. Leave `reviews: many(reviews)` on `usersRelations`.

- [ ] **Step 7: Rewrite `makeReview`**

In `c2c-e-commerce/src/test/factories.ts`, replace `MakeReviewOptions` and `makeReview` with:

```ts
export type MakeReviewOptions = Partial<Pick<Review, "rating" | "comment">> & {
  reviewerId?: number;
  /** The transaction being reviewed. Created if omitted. */
  orderId?: number;
  /**
   * Convenience for "a review of this listing": creates a completed order for it and
   * anchors the review to that. Ignored when `orderId` is given.
   */
  listingId?: number;
  /** For tests that care about the order of a timeline. */
  createdAt?: Date;
};

/**
 * A review, its order, and the seller's aggregates, all consistent.
 *
 * The aggregate write is not optional politeness: `users.review_count` is what
 * `GET /api/users/{id}/reviews` paginates on, so a factory that wrote the review alone
 * would leave every test reading a seller with reviews and a count of zero — and the
 * tests that caught it would blame the route.
 */
export async function makeReview(options: MakeReviewOptions = {}): Promise<Review> {
  const db = await getTestDb();

  const reviewerId = options.reviewerId ?? (await makeUser({ role: "buyer" })).id;
  const orderId =
    options.orderId ??
    (
      await makeOrder({
        buyerId: reviewerId,
        status: "completed",
        ...(options.listingId !== undefined ? { listingId: options.listingId } : {}),
      })
    ).id;

  // Read rather than assumed: a caller may have supplied an order this factory did not
  // create, and the subject of a review is whoever sold that order.
  const [order] = await db
    .select({ sellerId: orders.sellerId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) throw new Error(`makeReview: order ${orderId} does not exist`);

  // The reviews table carries CHECK (rating BETWEEN 1 AND 5); a default outside that
  // range would make the factory unusable.
  const rating = options.rating ?? 5;

  const [review] = await db
    .insert(reviews)
    .values({
      reviewerId,
      sellerId: order.sellerId,
      orderId,
      rating,
      comment: options.comment ?? "Solid.",
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
    })
    .returning();

  await db
    .update(users)
    .set({
      reviewCount: sql`${users.reviewCount} + 1`,
      ratingSum: sql`${users.ratingSum} + ${rating}`,
    })
    .where(eq(users.id, order.sellerId));

  return review;
}
```

Add `sql` to the `drizzle-orm` import at the top of the file (it currently imports `eq` only).

- [ ] **Step 8: Update the factory harness test**

In `c2c-e-commerce/src/test/harness/factories.integration.test.ts`, replace the two `makeReview` cases with:

```ts
  it("AC5: makeReview creates a reviewer, an order and the review between them", async () => {
    const review = await makeReview();
    const db = await getTestDb();

    expect(review.id).toEqual(expect.any(Number));
    // The reviews table has a CHECK (rating BETWEEN 1 AND 5); a default outside it would
    // make the factory unusable.
    expect(review.rating).toBeGreaterThanOrEqual(1);
    expect(review.rating).toBeLessThanOrEqual(5);

    // The subject is the order's seller, which is what the new model means by a review.
    const [order] = await db.select().from(orders).where(eq(orders.id, review.orderId));
    expect(order.status).toBe("completed");
    expect(order.buyerId).toBe(review.reviewerId);
    expect(review.sellerId).toBe(order.sellerId);
  });

  it("AC5: makeReview honours an explicit rating and listing", async () => {
    const listing = await makeListing();
    const review = await makeReview({ listingId: listing.id, rating: 4 });
    const db = await getTestDb();

    const [order] = await db.select().from(orders).where(eq(orders.id, review.orderId));
    expect(order.listingId).toBe(listing.id);
    expect(review.rating).toBe(4);
  });

  it("AC5: makeReview keeps the seller's aggregates true", async () => {
    // A factory that wrote the review alone would leave every test reading a seller with
    // reviews and a count of zero.
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    await makeReview({ listingId: listing.id, rating: 4 });

    const [row] = await db.select().from(users).where(eq(users.id, seller.id));
    expect(row.reviewCount).toBe(1);
    expect(row.ratingSum).toBe(4);
  });
```

- [ ] **Step 9: Move the recommendations reviewed arm onto orders**

In `c2c-e-commerce/src/app/api/recommendations/route.ts`, replace the second query in the `Promise.all` with:

```ts
      db
        .select({
          embedding: listings.embedding,
          rating: reviews.rating,
          at: reviews.createdAt,
        })
        .from(reviews)
        // Through the order, because that is where the listing lives now. A reviewed
        // listing is therefore always an ordered listing too, and contributes to the taste
        // vector twice — deliberately: `INTERACTION_WEIGHTS` exists to make a five-star
        // purchase count for more than a silent one.
        .innerJoin(orders, eq(orders.id, reviews.orderId))
        .innerJoin(listings, eq(listings.id, orders.listingId))
        .where(eq(reviews.reviewerId, userId))
        .orderBy(desc(reviews.createdAt))
        .limit(MAX_INTERACTIONS),
```

- [ ] **Step 10: Update the three recommendations tests the model change reaches**

In `c2c-e-commerce/src/app/api/recommendations/route.integration.test.ts`:

**(a)** Rename the AC1 review case, since a review with no order behind it is no longer representable:

```ts
  it("AC1: a completed, reviewed order is enough history to personalise", async () => {
    const buyer = await makeUser({ role: "buyer" });
    await makeReview({
      reviewerId: buyer.id,
      listingId: inCluster("phones")[0].id,
      rating: 5,
    });

    const { body } = await recommend(authHeaderFor(buyer));
    expect(body.strategy).toBe("personalised");
  });
```

**(b)** Replace the AC3 case wholesale. Its premise — "reviewing is not owning" — died with the re-anchor: a review now requires a completed order, and completed orders are excluded. What still needs proving is that the reviewed arm is read at all, which the old test never checked:

```ts
  it("AC3: a five-star purchase pulls the ranking harder than a one-star one", async () => {
    // Both listings are excluded from the results — a review implies a completed order
    // now — so what this measures is the *weight* the reviewed arm contributes.
    // `INTERACTION_WEIGHTS` scores a 1-star review at 0 and a 5-star at 1, on top of the
    // 0.6 every order earns, so the phone should win the ranking outright.
    const buyer = await makeUser({ role: "buyer" });

    await makeReview({ reviewerId: buyer.id, listingId: inCluster("phones")[0].id, rating: 5 });
    await makeReview({ reviewerId: buyer.id, listingId: inCluster("furniture")[0].id, rating: 1 });

    const { body } = await recommend(authHeaderFor(buyer), "limit=20");
    const clusterById = new Map(catalogue.map((entry) => [entry.id, entry.cluster]));

    expect(body.strategy).toBe("personalised");
    expect(clusterById.get(body.data[0].id)).toBe("phones");
  });
```

**(c)** In the interaction-cap test, the 50 reviews now need 50 orders. Replace the `await db.insert(reviews).values(...)` block with:

```ts
    // 50 reviews of a sofa, all from more than a year ago. One order each: `order_id` is
    // unique now, so fifty reviews mean fifty transactions.
    const furnitureOrders = await db
      .insert(orders)
      .values(
        Array.from({ length: 50 }, (_, i) => ({
          buyerId: buyer.id,
          sellerId: cyclingSellerId,
          listingId: furniture.id,
          price: "10.00",
          status: "completed" as const,
          expiresAt: new Date(now - (400 + i) * day + 48 * 60 * 60 * 1000),
          createdAt: new Date(now - (400 + i) * day),
        })),
      )
      .returning({ id: orders.id });

    await db.insert(reviews).values(
      furnitureOrders.map((order, i) => ({
        reviewerId: buyer.id,
        sellerId: cyclingSellerId,
        orderId: order.id,
        rating: 5,
        comment: "Solid.",
        createdAt: new Date(now - (400 + i) * day),
      })),
    );
```

`cyclingSellerId` is already read a few lines above and is the seller of every catalogue listing, so it is the right value for both inserts.

- [ ] **Step 11: Run the touched projects**

Run: `cd c2c-e-commerce && npx vitest run --project integration src/db/schema/reviews-reanchor.integration.test.ts src/test/harness/factories.integration.test.ts src/app/api/recommendations/route.integration.test.ts`
Expected: all pass.

- [ ] **Step 12: Type-check, lint, and run the whole suite**

Run: `cd c2c-e-commerce && npx tsc --noEmit && npm run lint && npm test`
Expected: 0 failures. The count rises by the 8 new migration cases and the one new factory case; two existing cases were rewritten rather than added.

If `tsc` complains about `src/app/api/listings/[id]/reviews/route.ts` reading `reviews.listingId`, leave it alone — that column still exists and is still nullable, so the file compiles. Task 3 deletes it.

- [ ] **Step 13: Commit**

```bash
git add c2c-e-commerce/drizzle/0017_reviews_reanchor.sql \
        c2c-e-commerce/src/db/schema/ c2c-e-commerce/src/test/factories.ts \
        c2c-e-commerce/src/test/harness/factories.integration.test.ts \
        c2c-e-commerce/src/app/api/recommendations/
git commit -m "feat(reviews): re-anchor reviews to the order and the seller (0017)"
```

---

### Task 3: Retire the listing-scoped review surface

Spec §6.3 removes `GET` and `POST /api/listings/{id}/reviews`. Its `POST` has been unable to work since 0017 — the route inserts a review with no `order_id`, which is now `NOT NULL` — so leaving it in place would mean shipping an endpoint that answers 500 by construction. The component and the page section that call it go with it; Task 8 builds their replacements.

**Files:**
- Delete: `c2c-e-commerce/src/app/api/listings/[id]/reviews/route.ts` (and the now-empty `reviews/` directory)
- Delete: `c2c-e-commerce/src/components/listings/ListingReviews.tsx`
- Modify: `c2c-e-commerce/src/components/listings/index.ts`
- Modify: `c2c-e-commerce/src/app/(frontend)/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This task only removes.

- [ ] **Step 1: Delete the route and the component**

```bash
cd c2c-e-commerce
git rm -r "src/app/api/listings/[id]/reviews"
git rm src/components/listings/ListingReviews.tsx
```

- [ ] **Step 2: Drop the barrel export**

In `c2c-e-commerce/src/components/listings/index.ts`, remove these two lines:

```ts
export { default as ListingReviews } from "./ListingReviews";
export type { ListingReviewsProps } from "./ListingReviews";
```

- [ ] **Step 3: Strip the review block from the listing detail page**

In `c2c-e-commerce/src/app/(frontend)/listings/[id]/page.tsx`, remove:

- the `import ListingReviews from "@/components/listings/ListingReviews";` line;
- `Review` from the `@/types/api` import list;
- the `const { data: reviewData, refetch: refetchReviews } = useFetch<Review[]>(…)` call;
- the `const canReview = isAuthenticated;` line and its comment;
- the whole `<ListingReviews … />` element.

`isAuthenticated` is still used by `handleBuyNow`, so leave the `useAuth()` destructuring alone.

- [ ] **Step 4: Type-check and lint**

Run: `cd c2c-e-commerce && npx tsc --noEmit && npm run lint`
Expected: both clean. An unused-import error here means one of the four removals in Step 3 was missed.

- [ ] **Step 5: Confirm nothing still calls the deleted endpoint**

Run: `cd c2c-e-commerce && grep -rn "listings/\${.*}/reviews\|listings/\[id\]/reviews" src/ || echo "no references"`
Expected: `no references`.

- [ ] **Step 6: Run the whole suite**

Run: `cd c2c-e-commerce && npm test`
Expected: 0 failures. No test covered the deleted route, so the count is unchanged from Task 2.

- [ ] **Step 7: Commit**

```bash
git add -A c2c-e-commerce/src
git commit -m "refactor(reviews): remove the listing-scoped review endpoints and UI"
```

---
### Task 4: The aggregate write, and one home for unique-violation detection

`src/db/reviews.ts` is to Part 4 what `src/db/orders.ts` is to Part 3: the statements the routes are assembled from, executor-parameterised so they run inside the caller's transaction. It needs to recognise a unique-index violation, and so does `src/db/orders.ts` already — so the second caller is written by extracting the first rather than by copying it.

That extraction matters more than it looks. Drizzle wraps the driver's error in a `DrizzleQueryError`, so `code` and `constraint` live on `.cause`, not on the error the handler catches. A branch written the obvious way silently never matches and the 500 it was meant to replace survives, invisibly, because every happy-path test still passes. That knowledge belongs in one file.

**Files:**
- Create: `c2c-e-commerce/src/db/pg-errors.ts`
- Create: `c2c-e-commerce/src/db/pg-errors.test.ts`
- Create: `c2c-e-commerce/src/db/reviews.ts`
- Create: `c2c-e-commerce/src/db/reviews.integration.test.ts`
- Modify: `c2c-e-commerce/src/db/orders.ts` (replace the private helpers with a delegation)

**Interfaces:**
- Consumes: `RatingDelta` from `@/lib/reviews` (Task 1); `reviews_one_per_order_idx` from Task 2.
- Produces:
  - `isUniqueViolation(err: unknown, indexName: string): boolean` from `@/db/pg-errors`
  - `type ReviewExecutor` — the same union `OrderExecutor` uses
  - `applyRatingDelta(x: ReviewExecutor, sellerId: number, delta: RatingDelta): Promise<number>`
  - `ONE_REVIEW_PER_ORDER_INDEX = "reviews_one_per_order_idx"`
  - `isDuplicateReviewViolation(err: unknown): boolean`

- [ ] **Step 1: Write the failing unit test for the error helper**

Create `c2c-e-commerce/src/db/pg-errors.test.ts`:

```ts
/**
 * Recognising a Postgres unique violation through Drizzle's wrapper.
 *
 * This is a two-line function that has already been got wrong once. Drizzle does not
 * rethrow the driver's error; it wraps it, so `code` and `constraint` are on `.cause`.
 * Written the obvious way the branch never matches, every happy-path test still passes,
 * and the 500 it was meant to replace survives in production.
 */
import { describe, expect, it } from "vitest";

import { isUniqueViolation } from "./pg-errors";

const INDEX = "widgets_one_per_thing_idx";

/** What `pg` throws. */
const driverError = (constraint: string) =>
  Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });

/** What Drizzle hands the caller. */
const wrapped = (cause: unknown) =>
  Object.assign(new Error("Failed query"), { cause });

describe("isUniqueViolation", () => {
  it("recognises the driver's own error", () => {
    expect(isUniqueViolation(driverError(INDEX), INDEX)).toBe(true);
  });

  it("recognises it one level down, where Drizzle actually puts it", () => {
    expect(isUniqueViolation(wrapped(driverError(INDEX)), INDEX)).toBe(true);
  });

  it("does not match a different index", () => {
    // Two unique indexes on one table would otherwise map to the same status code and
    // the same message, which is worse than a 500.
    expect(isUniqueViolation(wrapped(driverError("some_other_idx")), INDEX)).toBe(false);
  });

  it("does not match a different Postgres error on the right index", () => {
    const notNull = Object.assign(new Error("null value"), {
      code: "23502",
      constraint: INDEX,
    });
    expect(isUniqueViolation(wrapped(notNull), INDEX)).toBe(false);
  });

  it("is safe on anything at all", () => {
    for (const value of [null, undefined, "boom", 42, new Error("plain"), {}]) {
      expect(isUniqueViolation(value, INDEX)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd c2c-e-commerce && npx vitest run --project unit src/db/pg-errors.test.ts`
Expected: FAIL — `Failed to resolve import "./pg-errors"`.

- [ ] **Step 3: Write `src/db/pg-errors.ts`**

```ts
// ─── Reading Postgres errors through Drizzle ──────────────────────────────────
//
// A unique index is the last line of defence behind an application's own guards, and
// reaching it means a real conflict — a 409, not the 500 an unmapped constraint violation
// becomes. Recognising one takes two field reads, and getting those two field reads wrong
// is silent: the branch never matches, every happy-path test still passes, and the 500
// survives.
//
// One file, two callers (`src/db/orders.ts` and `src/db/reviews.ts`), because the thing
// worth stating once is *where* the fields are.

/** Postgres's SQLSTATE for `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Whether this error is the named unique index refusing a duplicate.
 *
 * Drizzle wraps the driver's error in a `DrizzleQueryError` rather than throwing it
 * directly, so `code` and `constraint` live on `.cause`, not on the error the caller
 * catches. Checking the error itself first keeps this correct if that ever stops being
 * true; falling back to one level of `.cause` is what makes it correct today.
 *
 * The index name is required rather than optional. Two unique indexes on one table would
 * otherwise collapse into one branch answering with one message, which is a worse failure
 * than the 500 this replaces.
 */
export function isUniqueViolation(err: unknown, indexName: string): boolean {
  return matches(err, indexName) || matches(cause(err), indexName);
}

function matches(err: unknown, indexName: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { code?: unknown; constraint?: unknown };
  return candidate.code === UNIQUE_VIOLATION && candidate.constraint === indexName;
}

function cause(err: unknown): unknown {
  if (typeof err !== "object" || err === null) return undefined;
  return (err as { cause?: unknown }).cause;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd c2c-e-commerce && npx vitest run --project unit src/db/pg-errors.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Point `src/db/orders.ts` at it**

In `c2c-e-commerce/src/db/orders.ts`, delete the private `isOneLiveOrderPgError` and `getCause` helpers and replace the body of `isOneLiveOrderViolation`:

```ts
export function isOneLiveOrderViolation(err: unknown): boolean {
  return isUniqueViolation(err, ONE_LIVE_ORDER_INDEX);
}
```

Trim its doc comment to keep the *why* and drop the now-relocated *where*:

```ts
/**
 * Whether an error is that index refusing a second live order.
 *
 * The index is the last line of defence behind `claimListing`'s conditional update and the
 * listing routes' guards. Reaching it means something upstream let a listing be relisted
 * while an order still held it — a real conflict, and a 409, not the 500 an unmapped
 * constraint violation would otherwise become.
 */
```

Add `import { isUniqueViolation } from "./pg-errors";` to the imports.

- [ ] **Step 6: Write the failing integration test for the aggregate write**

Create `c2c-e-commerce/src/db/reviews.integration.test.ts`:

```ts
/**
 * Part 4 spec §6.1 and D7 — the two statements a review write is made of.
 *
 * Tested on their own here, so a failure in a route's transaction points at the route
 * rather than at the SQL underneath it.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyRatingDelta,
  isDuplicateReviewViolation,
  ONE_REVIEW_PER_ORDER_INDEX,
} from "@/db/reviews";
import * as schema from "@/db/schema";
import { reviews, users } from "@/db/schema";
import { deleteDelta, insertDelta, updateDelta } from "@/lib/reviews";
import { getTestDb, resetDb, testPool } from "@/test/db";
import { makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function aggregatesOf(userId: number) {
  const db = await getTestDb();
  const [row] = await db
    .select({ reviewCount: users.reviewCount, ratingSum: users.ratingSum })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

describe("applyRatingDelta", () => {
  it("moves both integers by the delta", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });

    const moved = await applyRatingDelta(db, seller.id, insertDelta(4));

    expect(moved).toBe(1);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 4 });
  });

  it("applies an edit without touching the count", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });

    await applyRatingDelta(db, seller.id, insertDelta(2));
    await applyRatingDelta(db, seller.id, updateDelta(2, 5));

    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 5 });
  });

  it("returns a seller to zero after a delete", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });

    await applyRatingDelta(db, seller.id, insertDelta(3));
    await applyRatingDelta(db, seller.id, deleteDelta(3));

    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 0, ratingSum: 0 });
  });

  it("reports 0 for a seller who does not exist", async () => {
    const db = await getTestDb();
    expect(await applyRatingDelta(db, 999_999, insertDelta(5))).toBe(0);
  });

  it("composes two overlapping writers instead of letting one overwrite the other", async () => {
    // The reason this is `x = x + n` rather than a recomputed COUNT/SUM. Two transactions
    // held open at once: the second's UPDATE blocks on the first's row lock, then applies
    // its delta to the committed row. A recompute would have both read the pre-insert
    // state and one of the two reviews would vanish from the total.
    const seller = await makeUser({ role: "seller" });

    // A dedicated pool, because the shared one is what `resetDb` and the factories use —
    // holding two of its connections open across a lock wait would starve them.
    const pool = await testPool();
    const a = await pool.connect();
    const b = await pool.connect();

    try {
      const dbA = drizzle(a, { schema });
      const dbB = drizzle(b, { schema });

      await a.query("BEGIN");
      await b.query("BEGIN");

      await applyRatingDelta(dbA, seller.id, insertDelta(5));

      // Deliberately not awaited yet: B's UPDATE has to reach the server and block on A's
      // row lock while A is still open, which is the interleaving under test.
      const bWrite = applyRatingDelta(dbB, seller.id, insertDelta(3));
      await new Promise((resolve) => setTimeout(resolve, 250));

      await a.query("COMMIT");
      await bWrite;
      await b.query("COMMIT");
    } finally {
      a.release();
      b.release();
      await pool.end();
    }

    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 2, ratingSum: 8 });
  });
});

describe("the one-review-per-order index", () => {
  it("refuses a second review on the same order", async () => {
    const db = await getTestDb();
    const order = await makeOrder({ status: "completed" });

    const row = {
      reviewerId: order.buyerId,
      sellerId: order.sellerId,
      orderId: order.id,
      rating: 5,
    };

    await db.insert(reviews).values(row);

    await expect(db.insert(reviews).values(row)).rejects.toThrow();
  });

  it("recognises that refusal, through Drizzle's wrapper", async () => {
    // The check the route's 409 depends on. Drizzle wraps the driver's error, so this is
    // the assertion that would fail if the branch were reading `code` off the wrapper.
    const db = await getTestDb();
    const order = await makeOrder({ status: "completed" });

    const row = {
      reviewerId: order.buyerId,
      sellerId: order.sellerId,
      orderId: order.id,
      rating: 5,
    };

    await db.insert(reviews).values(row);

    let caught: unknown;
    try {
      await db.insert(reviews).values(row);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isDuplicateReviewViolation(caught)).toBe(true);
  });

  it("names the index the migration actually created", async () => {
    const db = await getTestDb();
    const result = await db.execute(
      `SELECT indexname FROM pg_indexes WHERE indexname = '${ONE_REVIEW_PER_ORDER_INDEX}'`,
    );

    expect(result.rows).toHaveLength(1);
  });

  it("allows two reviews of the same seller on different orders", async () => {
    // The re-anchor's whole purpose: reputation accumulates. A constraint that scoped to
    // the seller instead of the order would defeat it.
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });
    const first = await makeOrder({ status: "completed", sellerId: seller.id });
    const second = await makeOrder({ status: "completed", sellerId: seller.id });

    await db.insert(reviews).values([
      { reviewerId: first.buyerId, sellerId: seller.id, orderId: first.id, rating: 5 },
      { reviewerId: second.buyerId, sellerId: seller.id, orderId: second.id, rating: 3 },
    ]);

    expect(await db.select().from(reviews).where(eq(reviews.sellerId, seller.id))).toHaveLength(2);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `cd c2c-e-commerce && npx vitest run --project integration src/db/reviews.integration.test.ts`
Expected: FAIL — `Failed to resolve import "@/db/reviews"`.

- [ ] **Step 8: Write `src/db/reviews.ts`**

```ts
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
```

- [ ] **Step 9: Run it and watch it pass**

Run: `cd c2c-e-commerce && npx vitest run --project integration src/db/reviews.integration.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 10: Prove the concurrency test can fail**

Temporarily rewrite `applyRatingDelta`'s statement as an absolute recompute:

```sql
    UPDATE "users" AS u
       SET "review_count" = (SELECT count(*) FROM "reviews" WHERE "seller_id" = u."id"),
           "rating_sum"   = (SELECT coalesce(sum("rating"), 0) FROM "reviews" WHERE "seller_id" = u."id")
     WHERE u."id" = ${sellerId}
     RETURNING u."id"
```

Run: `cd c2c-e-commerce && npx vitest run --project integration src/db/reviews.integration.test.ts`
Expected: FAIL — several cases, because with no reviews rows written the recompute zeroes everything. That failure proves the tests read the real statement.

Restore the increment. Re-run: PASS.

- [ ] **Step 11: Type-check, lint, and run the whole suite**

Run: `cd c2c-e-commerce && npx tsc --noEmit && npm run lint && npm test`
Expected: 0 failures; the count rises by 14.

- [ ] **Step 12: Commit**

```bash
git add c2c-e-commerce/src/db/pg-errors.ts c2c-e-commerce/src/db/pg-errors.test.ts \
        c2c-e-commerce/src/db/reviews.ts c2c-e-commerce/src/db/reviews.integration.test.ts \
        c2c-e-commerce/src/db/orders.ts
git commit -m "feat(reviews): aggregate writes and one home for unique-violation detection"
```

---

### Task 5: `POST /api/orders/[id]/review`

The only way to create a review. Spec §6.3: buyer of that order, status `completed`. The order id is the path, because the order is the thing being reviewed.

**Files:**
- Create: `c2c-e-commerce/src/app/api/orders/[id]/review/route.ts`
- Create: `c2c-e-commerce/src/app/api/orders/[id]/review/route.integration.test.ts`
- Modify: `c2c-e-commerce/src/app/api/orders/[id]/route.ts` (`GET` reports `reviewId`)

**Interfaces:**
- Consumes: `canReviewOrder` from `@/lib/reviews`, `insertDelta` from `@/lib/reviews`, `CreateReviewSchema` from `@/lib/validation`, `applyRatingDelta` and `isDuplicateReviewViolation` from `@/db/reviews`, `canViewOrder` and `HIDE_EXISTENCE_MESSAGE` from `@/lib/authorization`.
- Produces: `GET /api/orders/{id}` gains `reviewId: number | null`, which Task 8's order page reads to decide whether to offer the affordance.

- [ ] **Step 1: Write the failing integration test**

Create `c2c-e-commerce/src/app/api/orders/[id]/review/route.integration.test.ts`:

```ts
/**
 * Part 4 spec §6.2/§6.3 — POST /api/orders/[id]/review.
 *
 * Eligibility is one predicate over one row: the caller is this order's buyer and this
 * order completed. The duplicate check is the unique index, which is what makes the
 * concurrent case at the bottom of this file answer 409 rather than 500.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { reviews, users } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function post(
  orderId: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("./route");
  const response = await POST(
    new NextRequest(`http://localhost/api/orders/${orderId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(orderId) }) },
  );
  return { status: response.status, body: await response.json() };
}

/** A completed order between two fresh users, plus the buyer's token header. */
async function completedOrder() {
  const seller = await makeUser({ role: "seller" });
  const buyer = await makeUser({ role: "buyer" });
  const listing = await makeListing({ sellerId: seller.id, status: "sold" });
  const order = await makeOrder({
    buyerId: buyer.id,
    listingId: listing.id,
    status: "completed",
  });
  return { seller, buyer, listing, order };
}

describe("POST /api/orders/[id]/review — the happy path", () => {
  it("creates the review, anchored to the order and the seller", async () => {
    const { seller, buyer, order } = await completedOrder();

    const { status, body } = await post(
      order.id,
      { rating: 5, comment: "Arrived quickly." },
      authHeaderFor(buyer),
    );

    expect(status).toBe(201);
    expect(body).toMatchObject({
      reviewerId: buyer.id,
      sellerId: seller.id,
      orderId: order.id,
      rating: 5,
      comment: "Arrived quickly.",
    });
  });

  it("moves the seller's aggregates in the same breath", async () => {
    const db = await getTestDb();
    const { seller, buyer, order } = await completedOrder();

    await post(order.id, { rating: 4 }, authHeaderFor(buyer));

    const [row] = await db.select().from(users).where(eq(users.id, seller.id));
    expect(row.reviewCount).toBe(1);
    expect(row.ratingSum).toBe(4);
  });

  it("stores a blank comment as null", async () => {
    const { buyer, order } = await completedOrder();

    const { body } = await post(order.id, { rating: 3, comment: "   " }, authHeaderFor(buyer));

    expect(body.comment).toBeNull();
  });
});

describe("POST /api/orders/[id]/review — who may not", () => {
  it("rejects an anonymous caller with 401", async () => {
    const { order } = await completedOrder();
    expect((await post(order.id, { rating: 5 })).status).toBe(401);
  });

  it("hides the order from a stranger with 404, not 403", async () => {
    // Order ids are sequential; a 403 would confirm which ones are real.
    const { order } = await completedOrder();
    const stranger = await makeUser({ role: "buyer" });

    const { status } = await post(order.id, { rating: 5 }, authHeaderFor(stranger));

    expect(status).toBe(404);
  });

  it("refuses the seller of that order with 403", async () => {
    // Reviews are one-directional (D6): the seller can read this order and still has
    // nothing to say about it here.
    const { seller, order } = await completedOrder();

    const { status } = await post(order.id, { rating: 1 }, authHeaderFor(seller));

    expect(status).toBe(403);
  });

  it("refuses an admin, who can read the order but did not buy anything", async () => {
    const { order } = await completedOrder();
    const admin = await makeUser({ role: "admin" });

    const { status } = await post(order.id, { rating: 5 }, authHeaderFor(admin));

    expect(status).toBe(403);
  });

  it("refuses every status but completed", async () => {
    for (const status of ["pending", "confirmed", "shipped", "cancelled", "declined", "expired"] as const) {
      await resetDb();
      const seller = await makeUser({ role: "seller" });
      const buyer = await makeUser({ role: "buyer" });
      const listing = await makeListing({ sellerId: seller.id });
      const order = await makeOrder({ buyerId: buyer.id, listingId: listing.id, status });

      const response = await post(order.id, { rating: 5 }, authHeaderFor(buyer));

      expect(response.status, status).toBe(403);
    }
  });

  it("answers 404 for an order that does not exist", async () => {
    const buyer = await makeUser({ role: "buyer" });
    expect((await post(999_999, { rating: 5 }, authHeaderFor(buyer))).status).toBe(404);
  });

  it("answers 400 for a rating outside 1-5", async () => {
    const { buyer, order } = await completedOrder();
    expect((await post(order.id, { rating: 9 }, authHeaderFor(buyer))).status).toBe(400);
  });

  it("decides authorisation before it validates the body", async () => {
    // A stranger sending nonsense must not learn from a 400 that the order is real.
    const { order } = await completedOrder();
    const stranger = await makeUser({ role: "buyer" });

    const { status } = await post(order.id, { rating: 99 }, authHeaderFor(stranger));

    expect(status).toBe(404);
  });
});

describe("POST /api/orders/[id]/review — one review per transaction", () => {
  it("answers 409 on a second review of the same order", async () => {
    const { buyer, order } = await completedOrder();

    await post(order.id, { rating: 5 }, authHeaderFor(buyer));
    const { status } = await post(order.id, { rating: 1 }, authHeaderFor(buyer));

    expect(status).toBe(409);
  });

  it("leaves the aggregates untouched by the refused write", async () => {
    const db = await getTestDb();
    const { seller, buyer, order } = await completedOrder();

    await post(order.id, { rating: 5 }, authHeaderFor(buyer));
    await post(order.id, { rating: 1 }, authHeaderFor(buyer));

    const [row] = await db.select().from(users).where(eq(users.id, seller.id));
    expect(row).toMatchObject({ reviewCount: 1, ratingSum: 5 });
  });

  it("gives exactly one 201 and one 409 to two concurrent posts (spec §7)", async () => {
    const db = await getTestDb();
    const { seller, buyer, order } = await completedOrder();

    const [first, second] = await Promise.all([
      post(order.id, { rating: 5 }, authHeaderFor(buyer)),
      post(order.id, { rating: 4 }, authHeaderFor(buyer)),
    ]);

    const codes = [first.status, second.status].sort();
    expect(codes).toEqual([201, 409]);

    expect(await db.select().from(reviews).where(eq(reviews.orderId, order.id))).toHaveLength(1);

    const [row] = await db.select().from(users).where(eq(users.id, seller.id));
    expect(row.reviewCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd c2c-e-commerce && npx vitest run --project integration "src/app/api/orders/[id]/review"`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Write the route**

Create `c2c-e-commerce/src/app/api/orders/[id]/review/route.ts`:

```ts
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { applyRatingDelta, isDuplicateReviewViolation } from "@/db/reviews";
import { orders, reviews } from "@/db/schema";
import { HIDE_EXISTENCE_MESSAGE, canViewOrder } from "@/lib/authorization";
import { authenticate, AuthError } from "@/lib/middleware";
import { parseResourceId } from "@/lib/params";
import { jsonOk, jsonError } from "@/lib/response";
import { canReviewOrder, insertDelta } from "@/lib/reviews";
import { parseRequest, CreateReviewSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

// ─── POST /api/orders/[id]/review ─────────────────────────────────────────────
// The buyer on a completed order, and nobody else. No role gate: sellers buy too (D5),
// and an admin's read access to an order is not a licence to write its buyer's opinion.
// Body: { rating: number (1-5); comment?: string }

/**
 * @swagger
 * /api/orders/{id}/review:
 *   post:
 *     tags: [Reviews]
 *     summary: Review the seller on a completed order
 *     description: |
 *       Reviews are posted against the order because the order is the thing being
 *       reviewed — it is the proof that the transaction happened, and it is what makes
 *       one review per transaction enforceable.
 *
 *       Eligibility is the whole of the rule: the caller is this order's buyer and the
 *       order is `completed`. A caller who is not party to the order gets **404** rather
 *       than 403, because order ids are sequential.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Order ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 5
 *               comment:
 *                 type: string
 *                 nullable: true
 *                 example: Packed well, shipped the same day.
 *     responses:
 *       201:
 *         description: Review created; the seller's aggregates moved with it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Review'
 *       400:
 *         description: Invalid order id or body
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
 *         description: A party to the order who is not its buyer, or the order is not completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: No such order, or not the caller's
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: This order has already been reviewed
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
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);

    // 404 for "not yours", identical to "does not exist" (C2C-SEC-10 AC3). Decided before
    // the body is parsed, so a stranger cannot learn from a 400 that the order is real.
    if (!order || !canViewOrder(payload, order)) {
      return jsonError(HIDE_EXISTENCE_MESSAGE, 404);
    }

    // A party who is not the buyer — the seller, or an admin — gets 403 rather than 404:
    // they can already read this order, so there is nothing left to hide.
    if (!canReviewOrder(payload.sub, order)) {
      return jsonError("You can only review an order you completed as the buyer", 403);
    }

    const parsed = await parseRequest(request, CreateReviewSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { rating, comment } = parsed.data;

    // One transaction, because a review and the seller's totals are one act. Committing
    // them separately leaves a reputation that is wrong until the second write lands, and
    // nothing afterwards can tell you which write was missed.
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reviews)
        .values({
          reviewerId: payload.sub,
          sellerId: order.sellerId,
          orderId: order.id,
          rating,
          comment: comment ?? null,
        })
        .returning();

      await applyRatingDelta(tx, order.sellerId, insertDelta(rating));

      return row;
    });

    return jsonOk(created, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    // The duplicate check. A `SELECT` before the `INSERT` is exactly the check two
    // concurrent posts both pass, which is why `order_id` is unique and why this is a
    // caught violation rather than a query.
    if (isDuplicateReviewViolation(err)) {
      return jsonError("You have already reviewed this order", 409);
    }
    console.error("[POST /api/orders/[id]/review]", err);
    return jsonError("Internal server error");
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd c2c-e-commerce && npx vitest run --project integration "src/app/api/orders/[id]/review"`
Expected: PASS, 15 tests.

- [ ] **Step 5: Prove the 409 is real**

Temporarily delete the `isDuplicateReviewViolation` branch from the catch.

Run: `cd c2c-e-commerce && npx vitest run --project integration "src/app/api/orders/[id]/review"`
Expected: FAIL — "answers 409 on a second review of the same order" and the concurrent case, both receiving 500.

Restore it. Re-run: PASS.

- [ ] **Step 6: Report `reviewId` from `GET /api/orders/[id]`**

In `c2c-e-commerce/src/app/api/orders/[id]/route.ts`, inside `GET`, after the `coverImageIdsFor` call:

```ts
    // Whether this order has been reviewed, so the order page can offer the affordance
    // once and not again. Sent to both parties: a review of this seller is public the
    // moment it exists, so there is nothing here the seller cannot already read.
    const [review] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.orderId, row.order.id))
      .limit(1);
```

and add `reviewId: review?.id ?? null,` to the returned object. Add `reviews` to the `@/db/schema` import.

Extend the route's `@swagger` block for `GET` with the new property under the 200 response's schema, alongside `listingTitle` and `coverImageId`:

```
 *                 reviewId:
 *                   type: integer
 *                   nullable: true
 *                   description: The review of this order, if the buyer has left one
```

- [ ] **Step 7: Cover `reviewId` in the order route's own test**

Find the integration test for `GET /api/orders/[id]` (`src/app/api/orders/[id]/route.integration.test.ts`) and add two cases to its `GET` describe block:

```ts
  it("reports reviewId as null on an order nobody has reviewed", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const order = await makeOrder({ buyerId: buyer.id, status: "completed" });

    const { body } = await read(order.id, authHeaderFor(buyer));

    expect(body.reviewId).toBeNull();
  });

  it("reports the review's id once one exists", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const order = await makeOrder({ buyerId: buyer.id, status: "completed" });
    const review = await makeReview({ orderId: order.id, reviewerId: buyer.id });

    const { body } = await read(order.id, authHeaderFor(buyer));

    expect(body.reviewId).toBe(review.id);
  });
```

The file's `read(orderId, headers)` helper already issues the `GET`; add `makeReview` to its factory import.

- [ ] **Step 8: Type-check, lint, and run the whole suite**

Run: `cd c2c-e-commerce && npx tsc --noEmit && npm run lint && npm test`
Expected: 0 failures; the count rises by 17.

- [ ] **Step 9: Commit**

```bash
git add "c2c-e-commerce/src/app/api/orders/[id]"
git commit -m "feat(reviews): POST /api/orders/[id]/review, one review per transaction"
```

---
### Task 6: `PATCH` and `DELETE /api/reviews/[id]` adjust the aggregates

Spec §6.3: author or admin, and both verbs move `review_count`/`rating_sum`. `DELETE` exists already and does not — it has had nothing to adjust until now.

**Files:**
- Create: `c2c-e-commerce/src/app/api/reviews/[id]/route.integration.test.ts`
- Modify: `c2c-e-commerce/src/app/api/reviews/[id]/route.ts`
- Modify: `c2c-e-commerce/src/app/api/rbac.integration.test.ts`

**Interfaces:**
- Consumes: `canMutateReview` from `@/lib/authorization` (Task 1), `UpdateReviewSchema` from `@/lib/validation` (Task 1), `applyRatingDelta` from `@/db/reviews` (Task 4), `updateDelta`/`deleteDelta` from `@/lib/reviews` (Task 1).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing integration test**

Create `c2c-e-commerce/src/app/api/reviews/[id]/route.integration.test.ts`:

```ts
/**
 * Part 4 spec §6.3 — editing and deleting a review keeps the seller's aggregates true.
 *
 * The aggregates are denormalised (D7), which buys a rating on every listing card for the
 * price of one rule: every write to `reviews` moves them in the same transaction. This
 * file is that rule's proof for the two verbs that are not `POST`.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { reviews, users } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeOrder, makeReview, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function patch(
  id: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { PATCH } = await import("./route");
  const response = await PATCH(
    new NextRequest(`http://localhost/api/reviews/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: await response.json() };
}

async function remove(
  id: number,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { DELETE } = await import("./route");
  const response = await DELETE(
    new NextRequest(`http://localhost/api/reviews/${id}`, { method: "DELETE", headers }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: await response.json() };
}

async function aggregatesOf(userId: number) {
  const db = await getTestDb();
  const [row] = await db
    .select({ reviewCount: users.reviewCount, ratingSum: users.ratingSum })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

/** A seller with one three-star review from a buyer who is the review's author. */
async function reviewed() {
  const seller = await makeUser({ role: "seller" });
  const buyer = await makeUser({ role: "buyer" });
  const order = await makeOrder({ buyerId: buyer.id, sellerId: seller.id, status: "completed" });
  const review = await makeReview({ orderId: order.id, reviewerId: buyer.id, rating: 3 });
  return { seller, buyer, review };
}

describe("PATCH /api/reviews/[id]", () => {
  it("lets the author change the rating and moves the sum with it", async () => {
    const { seller, buyer, review } = await reviewed();

    const { status, body } = await patch(review.id, { rating: 5 }, authHeaderFor(buyer));

    expect(status).toBe(200);
    expect(body.rating).toBe(5);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 5 });
  });

  it("leaves the count alone — an edit is the same review", async () => {
    const { seller, buyer, review } = await reviewed();

    await patch(review.id, { rating: 1 }, authHeaderFor(buyer));

    expect((await aggregatesOf(seller.id)).reviewCount).toBe(1);
  });

  it("lets the author change only the comment, touching no aggregate", async () => {
    const { seller, buyer, review } = await reviewed();

    const { status, body } = await patch(
      review.id,
      { comment: "Second thoughts." },
      authHeaderFor(buyer),
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ comment: "Second thoughts.", rating: 3 });
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 3 });
  });

  it("lets an admin edit, for moderation", async () => {
    const { review } = await reviewed();
    const admin = await makeUser({ role: "admin" });

    expect((await patch(review.id, { rating: 4 }, authHeaderFor(admin))).status).toBe(200);
  });

  it("refuses the seller being reviewed with 403", async () => {
    // The one edit that would make the ratings worthless.
    const { seller, review } = await reviewed();

    const { status } = await patch(review.id, { rating: 5 }, authHeaderFor(seller));

    expect(status).toBe(403);
  });

  it("refuses an unrelated user with 403", async () => {
    const { review } = await reviewed();
    const stranger = await makeUser({ role: "buyer" });

    expect((await patch(review.id, { rating: 5 }, authHeaderFor(stranger))).status).toBe(403);
  });

  it("rejects an anonymous caller with 401", async () => {
    const { review } = await reviewed();
    expect((await patch(review.id, { rating: 5 })).status).toBe(401);
  });

  it("answers 404 for a review that does not exist", async () => {
    const author = await makeUser({ role: "buyer" });
    expect((await patch(999_999, { rating: 5 }, authHeaderFor(author))).status).toBe(404);
  });

  it("answers 400 for an empty body", async () => {
    const { buyer, review } = await reviewed();
    expect((await patch(review.id, {}, authHeaderFor(buyer))).status).toBe(400);
  });

  it("answers 400 for a rating outside 1-5, leaving the aggregates alone", async () => {
    // Without the schema this reaches the CHECK constraint and becomes a 500 — with the
    // seller's totals already moved, because the delta would have been applied first.
    const { seller, buyer, review } = await reviewed();

    const { status } = await patch(review.id, { rating: 0 }, authHeaderFor(buyer));

    expect(status).toBe(400);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 3 });
  });
});

describe("DELETE /api/reviews/[id]", () => {
  it("removes the review and takes its rating out of the aggregates", async () => {
    const db = await getTestDb();
    const { seller, buyer, review } = await reviewed();

    const { status } = await remove(review.id, authHeaderFor(buyer));

    expect(status).toBe(200);
    expect(await db.select().from(reviews).where(eq(reviews.id, review.id))).toHaveLength(0);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 0, ratingSum: 0 });
  });

  it("leaves a seller's other reviews in the total", async () => {
    const seller = await makeUser({ role: "seller" });
    const keeper = await makeUser({ role: "buyer" });
    const regretter = await makeUser({ role: "buyer" });

    const first = await makeOrder({
      sellerId: seller.id,
      buyerId: keeper.id,
      status: "completed",
    });
    const second = await makeOrder({
      sellerId: seller.id,
      buyerId: regretter.id,
      status: "completed",
    });

    await makeReview({ orderId: first.id, reviewerId: keeper.id, rating: 5 });
    const doomed = await makeReview({ orderId: second.id, reviewerId: regretter.id, rating: 2 });

    await remove(doomed.id, authHeaderFor(regretter));

    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 5 });
  });

  it("refuses a non-author with 403 and changes nothing", async () => {
    const { seller, review } = await reviewed();
    const stranger = await makeUser({ role: "buyer" });

    const { status } = await remove(review.id, authHeaderFor(stranger));

    expect(status).toBe(403);
    expect(await aggregatesOf(seller.id)).toEqual({ reviewCount: 1, ratingSum: 3 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd c2c-e-commerce && npx vitest run --project integration "src/app/api/reviews/[id]"`
Expected: FAIL — `PATCH` is not exported by the route module.

- [ ] **Step 3: Add `PATCH` and make `DELETE` adjust the aggregates**

In `c2c-e-commerce/src/app/api/reviews/[id]/route.ts`, add the imports:

```ts
import { db } from "@/db";
import { applyRatingDelta } from "@/db/reviews";
import { deleteDelta, updateDelta } from "@/lib/reviews";
import { parseRequest, UpdateReviewSchema } from "@/lib/validation";
```

Add the `PATCH` handler above the existing `DELETE`:

```ts
// ─── PATCH /api/reviews/[id] ──────────────────────────────────────────────────
// Authenticated. Author or admin. Both fields optional, at least one required.

/**
 * @swagger
 * /api/reviews/{id}:
 *   patch:
 *     tags: [Reviews]
 *     summary: Edit a review
 *     description: |
 *       Changes the rating, the comment, or both. Only the author or an admin may edit —
 *       deliberately **not** the seller being reviewed, which is the one edit that would
 *       make the ratings worthless.
 *
 *       A changed rating moves the seller's `ratingSum` in the same transaction and leaves
 *       `reviewCount` alone: it is still one review.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Review ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 4
 *               comment:
 *                 type: string
 *                 nullable: true
 *                 example: Revised after a second look.
 *     responses:
 *       200:
 *         description: The updated review
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Review'
 *       400:
 *         description: Invalid review id, or no updatable fields
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
 *         description: Not the author or an admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Review not found
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
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid review id", 400);

    const [review] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!review) return jsonError("Review not found", 404);

    // 403 rather than 404: a review is a public object, readable by anyone through
    // `GET /api/users/{id}/reviews`, so hiding its existence would protect nothing.
    if (!canMutateReview(payload, review)) {
      return jsonError("Forbidden", 403);
    }

    const parsed = await parseRequest(request, UpdateReviewSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { rating, comment } = parsed.data;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(reviews)
        .set({
          ...(rating !== undefined ? { rating } : {}),
          ...(comment !== undefined ? { comment } : {}),
        })
        .where(eq(reviews.id, id))
        .returning();

      // Only the sum moves, and only when the rating actually changed. `updateDelta`
      // returns a zero delta for an unchanged rating, so the guard is an optimisation
      // rather than the correctness — but a no-op UPDATE on `users` for every comment
      // edit is a row lock nobody asked for.
      if (rating !== undefined && rating !== review.rating) {
        await applyRatingDelta(tx, review.sellerId, updateDelta(review.rating, rating));
      }

      return row;
    });

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PATCH /api/reviews/[id]]", err);
    return jsonError("Internal server error");
  }
}
```

Replace the body of `DELETE`'s write with a transaction:

```ts
    await db.transaction(async (tx) => {
      await tx.delete(reviews).where(eq(reviews.id, id));
      await applyRatingDelta(tx, review.sellerId, deleteDelta(review.rating));
    });
```

Update `DELETE`'s doc comment above `canMutateReview` — it currently says "the reviewed listing's seller", which is now simply "the seller":

```ts
    // Author or admin. Deliberately not the seller being reviewed -- that is the one
    // deletion that would make the ratings worthless.
```

and add a line to its `@swagger` description noting that the seller's aggregates are adjusted with it.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd c2c-e-commerce && npx vitest run --project integration "src/app/api/reviews/[id]"`
Expected: PASS, 13 tests.

- [ ] **Step 5: Prove the aggregate adjustment can fail**

Temporarily remove the `applyRatingDelta` call from `DELETE`'s transaction.

Run: `cd c2c-e-commerce && npx vitest run --project integration "src/app/api/reviews/[id]"`
Expected: FAIL — "removes the review and takes its rating out of the aggregates" and "leaves a seller's other reviews in the total".

Restore it. Do the same for `PATCH`'s call and confirm the first two `PATCH` cases fail. Restore.

- [ ] **Step 6: Add the RBAC rows**

In `c2c-e-commerce/src/app/api/rbac.integration.test.ts`, rename the describe block to `describe("C2C-SEC-10 AC6 / Part 4 §6.3 — PATCH and DELETE /api/reviews/[id]", …)` and add two cases inside it, in the file's existing `call(...)` style:

```ts
  it("refuses an edit of someone else's review with 403", async () => {
    const author = await makeUser({ role: "buyer" });
    const other = await makeUser({ role: "buyer" });
    const review = await makeReview({ reviewerId: author.id });

    const response = await call("./reviews/[id]/route", "PATCH", `/api/reviews/${review.id}`, {
      headers: authHeaderFor(other),
      body: { rating: 1 },
      params: { id: String(review.id) },
    });

    expect(response.status).toBe(403);
  });

  it("refuses the seller being reviewed, who is the one person with a motive", async () => {
    const author = await makeUser({ role: "buyer" });
    const review = await makeReview({ reviewerId: author.id });
    const db = await getTestDb();
    const [row] = await db.select().from(users).where(eq(users.id, review.sellerId));

    const response = await call("./reviews/[id]/route", "DELETE", `/api/reviews/${review.id}`, {
      headers: authHeaderFor(row),
      params: { id: String(review.id) },
    });

    expect(response.status).toBe(403);
    expect(await db.select().from(reviews)).toHaveLength(1);
  });
```

The `call` helper's method union already includes `"PUT"` but not `"PATCH"`. Add `"PATCH"` to both places the union appears in that file.

- [ ] **Step 7: Type-check, lint, and run the whole suite**

Run: `cd c2c-e-commerce && npx tsc --noEmit && npm run lint && npm test`
Expected: 0 failures; the count rises by 15.

- [ ] **Step 8: Commit**

```bash
git add "c2c-e-commerce/src/app/api/reviews/[id]" c2c-e-commerce/src/app/api/rbac.integration.test.ts
git commit -m "feat(reviews): PATCH and DELETE keep the seller's aggregates true"
```

---

### Task 7: `GET /api/users/[id]/reviews`, and a seller's reputation on the listing detail

Two reads, both public. The first is the seller profile's data source; the second puts a rating on the listing page without a `GROUP BY`, which is what D7 bought.

Note what this endpoint does **not** return: email, phone number, role, `emailVerified`, or anything else on the users row. `GET /api/users/{id}` stays `isSelfOrAdmin`. Publishing a seller's display name, avatar and rating is exactly what spec §6.4's profile page asks for and is the boundary of it.

**Files:**
- Create: `c2c-e-commerce/src/app/api/users/[id]/reviews/route.ts`
- Create: `c2c-e-commerce/src/app/api/users/[id]/reviews/route.integration.test.ts`
- Modify: `c2c-e-commerce/src/app/api/listings/[id]/route.ts` (`GET` only)
- Create: `c2c-e-commerce/src/app/api/listings/[id]/seller-reputation.integration.test.ts`

**Interfaces:**
- Consumes: `ratingAverage` from `@/lib/reviews` (Task 1).
- Produces, for Task 8:
  - `GET /api/users/{id}/reviews` → `{ seller: { id, name, avatarUrl, reviewCount, ratingSum, averageRating }, data: SellerReview[], total, page, limit, totalPages }`
  - `SellerReview` = `{ id, rating, comment, createdAt, reviewerId, reviewerName, orderId, sellerId }`
  - `GET /api/listings/{id}` gains `sellerAvatarUrl: string | null`, `sellerReviewCount: number`, `sellerRatingSum: number`

- [ ] **Step 1: Write the failing integration test**

Create `c2c-e-commerce/src/app/api/users/[id]/reviews/route.integration.test.ts`:

```ts
/**
 * Part 4 spec §6.3/§6.4 — GET /api/users/[id]/reviews.
 *
 * Public and paginated. `total` is read from `users.review_count` rather than counted,
 * which is what D7's two integers are for — and which means a drift between them and the
 * rows would show up here as broken pagination rather than as a wrong number nobody
 * notices.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { authHeaderFor } from "@/test/auth";
import { resetDb } from "@/test/db";
import { makeOrder, makeReview, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

type Body = {
  seller: {
    id: number;
    name: string;
    avatarUrl: string | null;
    reviewCount: number;
    ratingSum: number;
    averageRating: number | null;
  };
  data: { id: number; rating: number; reviewerName: string | null; orderId: number }[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

async function get(
  userId: number,
  query = "",
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Body }> {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/users/${userId}/reviews?${query}`, { headers }),
    { params: Promise.resolve({ id: String(userId) }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

/** A seller with `count` reviews, oldest first, rated 1..5 cycling. */
async function sellerWithReviews(count: number) {
  const seller = await makeUser({ role: "seller", name: "Ada Seller", avatarUrl: "/a.png" });

  for (let i = 0; i < count; i++) {
    const order = await makeOrder({ sellerId: seller.id, status: "completed" });
    await makeReview({
      orderId: order.id,
      reviewerId: order.buyerId,
      rating: (i % 5) + 1,
      createdAt: new Date(Date.UTC(2026, 0, i + 1)),
    });
  }

  return seller;
}

describe("GET /api/users/[id]/reviews — the summary", () => {
  it("is public: no token, still answers", async () => {
    const seller = await sellerWithReviews(1);
    expect((await get(seller.id)).status).toBe(200);
  });

  it("reports the seller's name, avatar and derived average", async () => {
    // Ratings 1..5 across five reviews: sum 15, mean 3.
    const seller = await sellerWithReviews(5);

    const { body } = await get(seller.id);

    expect(body.seller).toEqual({
      id: seller.id,
      name: "Ada Seller",
      avatarUrl: "/a.png",
      reviewCount: 5,
      ratingSum: 15,
      averageRating: 3,
    });
  });

  it("reports no rating at all for a seller nobody has reviewed", async () => {
    // Null rather than 0, which would render as five one-star reviews.
    const seller = await makeUser({ role: "seller" });

    const { body } = await get(seller.id);

    expect(body.seller.averageRating).toBeNull();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.totalPages).toBe(1);
  });

  it("never leaks anything else off the users row", async () => {
    // `GET /api/users/{id}` is isSelfOrAdmin and stays that way. This endpoint publishes
    // a display identity and a reputation, and that is the whole of it.
    const seller = await sellerWithReviews(1);

    const { body } = await get(seller.id);
    const raw = JSON.stringify(body.seller);

    expect(Object.keys(body.seller).sort()).toEqual([
      "avatarUrl",
      "averageRating",
      "id",
      "name",
      "ratingSum",
      "reviewCount",
    ]);
    expect(raw).not.toContain("@example.test");
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("$2b$");
  });

  it("answers 404 for a user who does not exist", async () => {
    expect((await get(999_999)).status).toBe(404);
  });

  it("answers 400 for an id that is not a positive integer", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/users/abc/reviews"),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/users/[id]/reviews — the list", () => {
  it("returns the newest review first, with its reviewer's name", async () => {
    const seller = await sellerWithReviews(3);

    const { body } = await get(seller.id);

    expect(body.data).toHaveLength(3);
    // Ratings were 1, 2, 3 oldest-to-newest, so newest-first starts at 3.
    expect(body.data.map((r) => r.rating)).toEqual([3, 2, 1]);
    expect(body.data[0].reviewerName).toEqual(expect.any(String));
  });

  it("paginates, taking its total from the denormalised count", async () => {
    const seller = await sellerWithReviews(7);

    const first = await get(seller.id, "page=1&limit=3");
    const last = await get(seller.id, "page=3&limit=3");

    expect(first.body).toMatchObject({ total: 7, page: 1, limit: 3, totalPages: 3 });
    expect(first.body.data).toHaveLength(3);
    expect(last.body.data).toHaveLength(1);
  });

  it("returns an empty page rather than an error past the end", async () => {
    const seller = await sellerWithReviews(2);

    const { status, body } = await get(seller.id, "page=9&limit=10");

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("ignores junk pagination instead of answering 400", async () => {
    const seller = await sellerWithReviews(2);

    const { body } = await get(seller.id, "page=-4&limit=notanumber");

    expect(body).toMatchObject({ page: 1, limit: 20 });
    expect(body.data).toHaveLength(2);
  });

  it("caps the page size", async () => {
    const seller = await sellerWithReviews(1);
    expect((await get(seller.id, "limit=5000")).body.limit).toBe(100);
  });

  it("shows only this seller's reviews", async () => {
    const seller = await sellerWithReviews(2);
    const other = await sellerWithReviews(3);

    const { body } = await get(seller.id);

    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(other.id).not.toBe(seller.id);
  });

  it("shows the same reviews to an authenticated stranger", async () => {
    const seller = await sellerWithReviews(2);
    const stranger = await makeUser({ role: "buyer" });

    const { body } = await get(seller.id, "", authHeaderFor(stranger));

    expect(body.data).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd c2c-e-commerce && npx vitest run --project integration "src/app/api/users/[id]/reviews"`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Write the route**

Create `c2c-e-commerce/src/app/api/users/[id]/reviews/route.ts`:

```ts
import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { reviews, users } from "@/db/schema";
import { parseResourceId } from "@/lib/params";
import { jsonOk, jsonError } from "@/lib/response";
import { ratingAverage } from "@/lib/reviews";

type RouteContext = { params: Promise<{ id: string }> };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ─── GET /api/users/[id]/reviews ──────────────────────────────────────────────
// Public. A seller's reputation and the reviews behind it.

/**
 * @swagger
 * /api/users/{id}/reviews:
 *   get:
 *     tags: [Reviews]
 *     summary: A seller's reviews, newest first
 *     description: |
 *       Public and paginated. The `seller` envelope carries the denormalised reputation
 *       (D7) and a derived `averageRating` — `null` for a seller nobody has reviewed,
 *       because a 0 would read as five one-star reviews.
 *
 *       Deliberately narrow: the display name, the avatar and the two counters, and
 *       nothing else off the user record. `GET /api/users/{id}` remains restricted to the
 *       user themselves and admins.
 *
 *       `total` is read from `reviewCount` rather than counted, which is what the
 *       denormalisation is for.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The seller's user ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: The seller's summary and a page of their reviews
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 seller:
 *                   type: object
 *                   properties:
 *                     id: { type: integer }
 *                     name: { type: string }
 *                     avatarUrl: { type: string, nullable: true }
 *                     reviewCount: { type: integer }
 *                     ratingSum: { type: integer }
 *                     averageRating: { type: number, nullable: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Review'
 *                       - type: object
 *                         properties:
 *                           reviewerName:
 *                             type: string
 *                             nullable: true
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *                 totalPages: { type: integer }
 *       400:
 *         description: Invalid user id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
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
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid user id", 400);

    // Projected column by column rather than `select()`. This endpoint is public and the
    // users row holds an email, a phone number and a password hash; a `select *` here is
    // one careless refactor away from publishing all three.
    const [seller] = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        reviewCount: users.reviewCount,
        ratingSum: users.ratingSum,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!seller) return jsonError("User not found", 404);

    const page = parsePositive(request.nextUrl.searchParams.get("page"), 1, Number.MAX_SAFE_INTEGER);
    const limit = parsePositive(request.nextUrl.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);

    const rows = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        reviewerId: reviews.reviewerId,
        sellerId: reviews.sellerId,
        orderId: reviews.orderId,
        reviewerName: users.name,
      })
      .from(reviews)
      .leftJoin(users, eq(users.id, reviews.reviewerId))
      .where(eq(reviews.sellerId, id))
      // `id` as a tiebreaker: two reviews written in the same millisecond would otherwise
      // order differently between pages and one of them would be skipped.
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(limit)
      .offset((page - 1) * limit);

    return jsonOk({
      seller: { ...seller, averageRating: ratingAverage(seller) },
      data: rows,
      // From the counter, not a COUNT(*). That is what D7 bought — and it means a drift
      // between the counter and the rows shows up here as broken pagination rather than
      // as a number nobody checks.
      total: seller.reviewCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(seller.reviewCount / limit)),
    });
  } catch (err) {
    console.error("[GET /api/users/[id]/reviews]", err);
    return jsonError("Internal server error");
  }
}

/**
 * A positive integer from a query parameter, or the fallback.
 *
 * Explicit rather than `parseInt(raw) || fallback`, which only works because 0 is falsy —
 * and which would let `page=-4` through as a negative offset.
 */
function parsePositive(raw: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd c2c-e-commerce && npx vitest run --project integration "src/app/api/users/[id]/reviews"`
Expected: PASS, 13 tests.

- [ ] **Step 5: Prove the projection test can fail**

Temporarily replace the seller projection with `db.select().from(users)`.

Run: `cd c2c-e-commerce && npx vitest run --project integration "src/app/api/users/[id]/reviews"`
Expected: FAIL — "never leaks anything else off the users row" and "reports the seller's name, avatar and derived average".

Restore the projection. Re-run: PASS.

- [ ] **Step 6: Put the seller's reputation on the listing detail**

In `c2c-e-commerce/src/app/api/listings/[id]/route.ts`, add three columns to `GET`'s select, after `sellerName`:

```ts
        sellerAvatarUrl: users.avatarUrl,
        sellerReviewCount: users.reviewCount,
        sellerRatingSum: users.ratingSum,
```

The join on `users` is already there, so this costs nothing extra — which is the point of D7: a rating on the listing page without a `GROUP BY` over reviews.

Add them to the route's `@swagger` 200 schema alongside `sellerName`:

```
 *                 sellerAvatarUrl:
 *                   type: string
 *                   nullable: true
 *                 sellerReviewCount:
 *                   type: integer
 *                 sellerRatingSum:
 *                   type: integer
```

- [ ] **Step 7: Cover it with a test**

There is no `route.integration.test.ts` under `src/app/api/listings/[id]/` — that route's cases live in files named for what they assert (`reserved.integration.test.ts`, `delete-storage.integration.test.ts`). Follow the convention. Create `c2c-e-commerce/src/app/api/listings/[id]/seller-reputation.integration.test.ts`:

```ts
/**
 * Part 4 spec §6.4 — the listing detail carries its seller's reputation.
 *
 * One join that was already there, and no `GROUP BY` over reviews. That is what
 * denormalising the aggregates (D7) was for: a seller card on every listing page for the
 * price of two integers.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDb } from "@/test/db";
import { makeListing, makeOrder, makeReview, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function readListing(id: number) {
  const { GET } = await import("./route");
  const response = await GET(new NextRequest(`http://localhost/api/listings/${id}`), {
    params: Promise.resolve({ id: String(id) }),
  });
  return { status: response.status, body: await response.json() };
}

describe("GET /api/listings/[id] — the seller's reputation", () => {
  it("carries name, avatar and both counters, so the page needs no second request", async () => {
    const seller = await makeUser({ role: "seller", name: "Ada Seller", avatarUrl: "/ada.png" });
    const listing = await makeListing({ sellerId: seller.id });
    const order = await makeOrder({ sellerId: seller.id, status: "completed" });
    await makeReview({ orderId: order.id, reviewerId: order.buyerId, rating: 4 });

    const { status, body } = await readListing(listing.id);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      sellerName: "Ada Seller",
      sellerAvatarUrl: "/ada.png",
      sellerReviewCount: 1,
      sellerRatingSum: 4,
    });
  });

  it("reports zeroes for a seller nobody has reviewed", async () => {
    // Not null: the columns are NOT NULL with a default of 0, and the UI derives "no
    // rating" from the count rather than from a missing field.
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    const { body } = await readListing(listing.id);

    expect(body).toMatchObject({ sellerReviewCount: 0, sellerRatingSum: 0 });
  });

  it("still does not publish the seller's embedding or contact details", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    const { body } = await readListing(listing.id);
    const raw = JSON.stringify(body);

    expect(raw).not.toContain("@example.test");
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("$2b$");
  });
});
```

- [ ] **Step 8: Type-check, lint, and run the whole suite**

Run: `cd c2c-e-commerce && npx tsc --noEmit && npm run lint && npm test`
Expected: 0 failures; the count rises by 16.

- [ ] **Step 9: Commit**

```bash
git add "c2c-e-commerce/src/app/api/users/[id]/reviews" "c2c-e-commerce/src/app/api/listings/[id]"
git commit -m "feat(reviews): public seller reviews endpoint and reputation on listing detail"
```

---
### Task 8: The UI — a seller card, a profile page, and a review affordance on the order

Spec §6.4. Four components, one new page, two edited pages, and the types they read.

The shape of the change is worth stating once: reviewing used to happen on the listing you bought, and now happens on the order you completed. So the listing page *shows* a reputation and links away to it, and the order page is where a review is written.

**Files:**
- Create: `c2c-e-commerce/src/components/reviews/StarRating.tsx`
- Create: `c2c-e-commerce/src/components/reviews/StarRating.component.test.tsx`
- Create: `c2c-e-commerce/src/components/reviews/SellerReviews.tsx`
- Create: `c2c-e-commerce/src/components/reviews/SellerReviews.component.test.tsx`
- Create: `c2c-e-commerce/src/components/reviews/SellerCard.tsx`
- Create: `c2c-e-commerce/src/components/reviews/ReviewForm.tsx`
- Create: `c2c-e-commerce/src/components/reviews/ReviewForm.component.test.tsx`
- Create: `c2c-e-commerce/src/components/reviews/index.ts`
- Create: `c2c-e-commerce/src/app/(frontend)/users/[id]/page.tsx`
- Modify: `c2c-e-commerce/src/types/api.ts`
- Modify: `c2c-e-commerce/src/app/(frontend)/listings/[id]/page.tsx`
- Modify: `c2c-e-commerce/src/app/(frontend)/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/users/{id}/reviews`, `GET /api/listings/{id}`'s three new seller fields, `GET /api/orders/{id}`'s `reviewId`, `POST /api/orders/{id}/review`.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Add the types**

In `c2c-e-commerce/src/types/api.ts`, replace the `// ─── Reviews ───` section with:

```ts
// ─── Reviews ──────────────────────────────────────────────────────────────────

/** One review, as `GET /api/users/[id]/reviews` returns it. */
export type SellerReview = Serialized<ReviewRow> & { reviewerName: string | null };

/** The subject of a review list — a public identity plus a reputation, and no more. */
export type SellerSummary = {
  id: number;
  name: string;
  avatarUrl: string | null;
  reviewCount: number;
  ratingSum: number;
  /** Derived server-side; `null` for a seller nobody has reviewed. */
  averageRating: number | null;
};

/** `GET /api/users/[id]/reviews` */
export type SellerReviewsResponse = Paginated<SellerReview> & {
  seller: SellerSummary;
};
```

Also add the seller reputation to `ListingDetail`:

```ts
/** `GET /api/listings/[id]` — adds the joined seller, their reputation, and the category. */
export type ListingDetail = Listing & {
  sellerName: string | null;
  sellerAvatarUrl: string | null;
  sellerReviewCount: number;
  sellerRatingSum: number;
  categoryName: string | null;
  images: ListingImageSummary[];
};
```

and `reviewId` to `OrderDetail`:

```ts
/** `GET /api/orders/[id]` — the order, the listing it is for, and its review if any. */
export type OrderDetail = Order & {
  listingTitle: string;
  coverImageId: number | null;
  /** The review this order already has, or null if the buyer has not left one. */
  reviewId: number | null;
};
```

The old `Review` type is gone; nothing imports it after Task 3.

- [ ] **Step 2: Write the failing test for `StarRating`**

Create `c2c-e-commerce/src/components/reviews/StarRating.component.test.tsx`:

```tsx
/**
 * Part 4 spec §6.4 — the stars.
 *
 * Display only. The rating it shows is derived from two integers server-side (D7), so
 * this component's whole job is to render a number honestly — including the case where
 * there is no number, which is not the same as zero.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StarRating from "./StarRating";

describe("StarRating", () => {
  it("fills the nearest whole number of stars", () => {
    render(<StarRating value={4.2} />);
    expect(screen.getByLabelText("Rated 4.2 out of 5")).toBeInTheDocument();
  });

  it("rounds up at the halfway point", () => {
    render(<StarRating value={3.5} />);
    expect(screen.getByLabelText("Rated 3.5 out of 5")).toBeInTheDocument();
  });

  it("says there is no rating rather than showing zero stars", () => {
    // Zero stars reads as five one-star reviews. A seller who has never sold anything has
    // no rating at all, which is a different statement.
    render(<StarRating value={null} />);
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Rated/)).toBeNull();
  });

  it("shows the review count when given one", () => {
    render(<StarRating value={5} count={12} />);
    expect(screen.getByText("(12)")).toBeInTheDocument();
  });

  it("renders one star per point, always five", () => {
    const { container } = render(<StarRating value={2} />);
    expect(container.querySelectorAll("[data-star]")).toHaveLength(5);
  });
});
```

- [ ] **Step 3: Run it and watch it fail, then write `StarRating`**

Run: `cd c2c-e-commerce && npx vitest run --project component src/components/reviews/StarRating.component.test.tsx`
Expected: FAIL — module not found.

Create `c2c-e-commerce/src/components/reviews/StarRating.tsx`:

```tsx
export type StarRatingProps = {
  /** The mean, or null for a seller nobody has reviewed. */
  value: number | null;
  /** How many reviews the mean is drawn from. Omitted where it is shown elsewhere. */
  count?: number;
  size?: "sm" | "md";
};

const SIZES = { sm: "text-sm", md: "text-lg" } as const;

/**
 * Five stars, filled to the nearest whole point.
 *
 * `null` is not zero. A seller with no reviews has no rating, and five empty stars reads
 * as five one-star ones — so that case gets words instead. The exact value stays in the
 * accessible label, because rounding to whole stars loses it.
 */
export default function StarRating({ value, count, size = "md" }: StarRatingProps) {
  if (value === null) {
    return <span className="text-sm text-zinc-500">No reviews yet</span>;
  }

  const filled = Math.round(value);

  return (
    <span className={`inline-flex items-center gap-1 ${SIZES[size]}`}>
      <span
        className="text-amber-500"
        aria-label={`Rated ${Number(value.toFixed(1))} out of 5`}
        role="img"
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} data-star={star}>
            {star <= filled ? "★" : "☆"}
          </span>
        ))}
      </span>
      {count !== undefined && (
        <span className="text-sm text-zinc-500">({count})</span>
      )}
    </span>
  );
}
```

Run the test again. Expected: PASS, 5 tests.

- [ ] **Step 4: Write the failing test for `SellerReviews`**

Create `c2c-e-commerce/src/components/reviews/SellerReviews.component.test.tsx`:

```tsx
/**
 * Part 4 spec §6.4 — the review list.
 *
 * Presentational. Submitting moved to the order page, so this component has no form, no
 * `canReview` prop and no idea who is looking at it.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SellerReviews from "./SellerReviews";
import type { SellerReview } from "@/types/api";

const review = (overrides: Partial<SellerReview> = {}): SellerReview => ({
  id: 1,
  reviewerId: 7,
  sellerId: 2,
  orderId: 11,
  listingId: null,
  rating: 5,
  comment: "Packed well.",
  createdAt: "2026-08-01T10:00:00.000Z",
  reviewerName: "Ada",
  ...overrides,
});

describe("SellerReviews", () => {
  it("renders one entry per review", () => {
    render(<SellerReviews reviews={[review({ id: 1 }), review({ id: 2 })]} />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("shows the reviewer's name and their comment", () => {
    render(<SellerReviews reviews={[review({ reviewerName: "Grace", comment: "Fast." })]} />);
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("Fast.")).toBeInTheDocument();
  });

  it("falls back to the reviewer's id when the name is missing", () => {
    render(<SellerReviews reviews={[review({ reviewerName: null, reviewerId: 42 })]} />);
    expect(screen.getByText("Buyer #42")).toBeInTheDocument();
  });

  it("says so when a review has no comment", () => {
    render(<SellerReviews reviews={[review({ comment: null })]} />);
    expect(screen.getByText("No comment.")).toBeInTheDocument();
  });

  it("shows an empty state rather than a bare heading", () => {
    render(<SellerReviews reviews={[]} />);
    expect(screen.getByText("No reviews yet.")).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run it, watch it fail, write `SellerReviews`**

Create `c2c-e-commerce/src/components/reviews/SellerReviews.tsx`:

```tsx
"use client";

import StarRating from "./StarRating";
import type { SellerReview } from "@/types/api";

export type SellerReviewsProps = {
  reviews: SellerReview[];
};

/**
 * A seller's reviews.
 *
 * Purely presentational, which is the difference from the `ListingReviews` it replaces:
 * that component carried the submit form as well, because a listing page was both where
 * you read reviews and where you wrote one. Reviews are written against an order now, so
 * this list has no form, no `canReview` prop and no notion of who is reading it.
 */
export default function SellerReviews({ reviews }: SellerReviewsProps) {
  if (reviews.length === 0) {
    return <p className="text-sm text-zinc-500">No reviews yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {reviews.map((review) => (
        <li key={review.id}>
          <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {review.reviewerName ?? `Buyer #${review.reviewerId}`}
                </p>
                <p className="text-xs text-zinc-500">
                  {new Date(review.createdAt).toLocaleDateString()}
                </p>
              </div>
              <StarRating value={review.rating} size="sm" />
            </div>
            <p className="text-sm text-zinc-600">{review.comment || "No comment."}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}
```

Run: `cd c2c-e-commerce && npx vitest run --project component src/components/reviews/SellerReviews.component.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing test for `ReviewForm`**

Create `c2c-e-commerce/src/components/reviews/ReviewForm.component.test.tsx`:

```tsx
/**
 * Part 4 spec §6.4 — "Leave a review", on the order.
 *
 * The order is the thing being reviewed, so this posts to `/api/orders/{id}/review`. The
 * 409 case matters as much as the happy path: two tabs, or a double click, and the second
 * write is refused by the unique index rather than by anything this component knows.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReviewForm from "./ReviewForm";

const post = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: { post } }));
vi.mock("react-hot-toast", () => ({
  default: { success: toastSuccess, error: toastError },
}));

beforeEach(() => {
  post.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Leave a review" }));
}

describe("ReviewForm", () => {
  it("posts the rating and comment against the order", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ id: 5 });
    const onSubmitted = vi.fn();

    render(<ReviewForm orderId={12} onSubmitted={onSubmitted} />);
    await open(user);

    await user.click(screen.getByLabelText("Set rating to 4"));
    await user.type(screen.getByLabelText("Comment"), "Shipped fast.");
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/orders/12/review", {
        rating: 4,
        comment: "Shipped fast.",
      }),
    );
    expect(onSubmitted).toHaveBeenCalled();
  });

  it("defaults to five stars, so a submit with no click still means something", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ id: 5 });

    render(<ReviewForm orderId={3} onSubmitted={vi.fn()} />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/orders/3/review", {
        rating: 5,
        comment: "",
      }),
    );
  });

  it("shows the server's message when the write is refused", async () => {
    // The 409 the unique index produces: two tabs, or a double click. The component does
    // not try to predict it — it reports what the server said.
    const user = userEvent.setup();
    post.mockRejectedValue(new Error("You have already reviewed this order"));
    const onSubmitted = vi.fn();

    render(<ReviewForm orderId={9} onSubmitted={onSubmitted} />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("You have already reviewed this order")).toBeInTheDocument();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("disables submit while the write is in flight", async () => {
    // A second click would be refused by the unique index rather than accepted, which is
    // correct and a confusing thing to show someone who simply double-clicked. `Button`
    // disables itself on `loading`, so the guard is one prop rather than a flag this
    // component has to keep in step with the request.
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    render(<ReviewForm orderId={4} onSubmitted={vi.fn()} />);
    await open(user);

    const submit = screen.getByRole("button", { name: "Submit review" });
    await user.click(submit);

    expect(submit).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);

    release({ id: 1 });
  });
});
```

- [ ] **Step 7: Run it, watch it fail, write `ReviewForm`**

Create `c2c-e-commerce/src/components/reviews/ReviewForm.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { Button, ErrorAlert, InputField, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { SellerReview } from "@/types/api";

export type ReviewFormProps = {
  /** The order being reviewed — the endpoint is keyed on it. */
  orderId: number;
  /** Called after a successful write, so the caller can refetch. */
  onSubmitted: () => void;
};

/**
 * "Leave a review", as a button and a modal.
 *
 * Posts to `/api/orders/{id}/review` because the order is the thing being reviewed.
 * Whether the caller is *allowed* to is the server's decision — this component is only
 * rendered when the order is completed, unreviewed and the viewer's own, and it reports
 * whatever the server says when that turns out to be stale.
 *
 * `loading={submitting}` on the submit button is the double-click guard: `Button`
 * disables itself while loading, and a disabled default button also suppresses implicit
 * submission on Enter. A second write would be refused by the unique index anyway — this
 * only stops someone being shown a 409 for double-clicking.
 */
export default function ReviewForm({ orderId, onSubmitted }: ReviewFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api.post<SellerReview>(`/api/orders/${orderId}/review`, { rating, comment });

      onSubmitted();
      setIsOpen(false);
      setComment("");
      setRating(5);
      toast.success("Review submitted!");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit review";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setIsOpen(true)}>
        Leave a review
      </Button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Review this seller">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <ErrorAlert message={error} />}

          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-700">Star rating</p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  className="text-2xl leading-none text-amber-500"
                  aria-label={`Set rating to ${value}`}
                >
                  {value <= rating ? "★" : "☆"}
                </button>
              ))}
            </div>
          </div>

          <InputField
            label="Comment"
            type="text"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="How did the sale go?"
          />

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit review
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
```

Run: `cd c2c-e-commerce && npx vitest run --project component src/components/reviews/ReviewForm.component.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 8: Prove the in-flight guard can fail**

Temporarily change the submit button to `<Button type="submit">Submit review</Button>`, dropping `loading={submitting}`.

Run: `cd c2c-e-commerce && npx vitest run --project component src/components/reviews/ReviewForm.component.test.tsx`
Expected: FAIL — "disables submit while the write is in flight".

Restore the prop. Re-run: PASS.

- [ ] **Step 9: Write `SellerCard` and the barrel**

Create `c2c-e-commerce/src/components/reviews/SellerCard.tsx`:

```tsx
"use client";

import Link from "next/link";

import StarRating from "./StarRating";
import { ratingAverage } from "@/lib/reviews";

export type SellerCardProps = {
  sellerId: number;
  name: string | null;
  avatarUrl: string | null;
  reviewCount: number;
  ratingSum: number;
};

/**
 * The seller block on a listing page (spec §6.4).
 *
 * What used to be a review list is now a link to one. A one-off listing's reviews were
 * always going to be thin; the seller's are the thing worth reading, and they live on
 * their own page.
 *
 * The average is derived here with the same function the API uses, rather than sent as a
 * third field — two integers and one shared rule beats a number computed in two places.
 */
export default function SellerCard({
  sellerId,
  name,
  avatarUrl,
  reviewCount,
  ratingSum,
}: SellerCardProps) {
  const displayName = name ?? `Seller #${sellerId}`;

  return (
    <section
      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
      aria-labelledby="seller-card-heading"
    >
      <h2 id="seller-card-heading" className="mb-3 text-sm font-semibold text-zinc-500">
        Sold by
      </h2>

      <Link href={`/users/${sellerId}`} className="flex items-center gap-3 group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            avatarUrl ??
            `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(displayName)}`
          }
          alt=""
          className="h-10 w-10 rounded-full border border-zinc-200 bg-zinc-50"
        />
        <div>
          <p className="font-medium text-zinc-900 group-hover:underline">{displayName}</p>
          <StarRating
            value={ratingAverage({ reviewCount, ratingSum })}
            count={reviewCount}
            size="sm"
          />
        </div>
      </Link>
    </section>
  );
}
```

Create `c2c-e-commerce/src/components/reviews/index.ts`:

```ts
export { default as StarRating } from "./StarRating";
export type { StarRatingProps } from "./StarRating";

export { default as SellerReviews } from "./SellerReviews";
export type { SellerReviewsProps } from "./SellerReviews";

export { default as SellerCard } from "./SellerCard";
export type { SellerCardProps } from "./SellerCard";

export { default as ReviewForm } from "./ReviewForm";
export type { ReviewFormProps } from "./ReviewForm";
```

- [ ] **Step 10: Build the seller profile page**

Create `c2c-e-commerce/src/app/(frontend)/users/[id]/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import SellerReviews from "@/components/reviews/SellerReviews";
import StarRating from "@/components/reviews/StarRating";
import { ErrorAlert, Skeleton } from "@/components/ui";
import { useFetch } from "@/hooks/useFetch";
import type { ListingsResponse, SellerReviewsResponse } from "@/types/api";

/**
 * A seller's public profile (spec §6.4).
 *
 * Two requests rather than one endpoint that returns both: the listings come from
 * `GET /api/listings?sellerId=`, which already knows that a stranger sees only `active`
 * rows. Duplicating that visibility rule in a new endpoint is how the two would drift.
 */
export default function SellerProfilePage() {
  const params = useParams<{ id: string }>();
  const sellerId = Number(params.id);
  const hasValidId = Number.isInteger(sellerId) && sellerId > 0;

  const { data, loading, error } = useFetch<SellerReviewsResponse>(
    hasValidId ? `/api/users/${sellerId}/reviews?limit=50` : null,
  );

  const { data: listingData } = useFetch<ListingsResponse>(
    hasValidId ? `/api/listings?sellerId=${sellerId}&limit=12` : null,
  );

  if (!hasValidId || (!loading && (error || !data))) {
    return <ErrorAlert message={!hasValidId ? "Invalid user id" : (error ?? "Seller not found")} />;
  }

  if (loading || !data) {
    return (
      <div className="space-y-6" aria-hidden="true">
        <Skeleton className="h-16 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { seller } = data;
  const listings = listingData?.data ?? [];

  return (
    <div className="space-y-8">
      <section className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            seller.avatarUrl ??
            `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seller.name)}`
          }
          alt=""
          className="h-16 w-16 rounded-full border border-zinc-200 bg-zinc-50"
        />
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{seller.name}</h1>
          <StarRating value={seller.averageRating} count={seller.reviewCount} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-zinc-900">
          Reviews {seller.reviewCount > 0 && `(${seller.reviewCount})`}
        </h2>
        <SellerReviews reviews={data.data} />
      </section>

      {listings.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-zinc-900">Also selling</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {listings.map((listing) => (
              <li key={listing.id}>
                <Link
                  href={`/listings/${listing.id}`}
                  className="block overflow-hidden rounded-lg border border-zinc-200 transition hover:border-zinc-400 hover:shadow-sm"
                >
                  {listing.coverImageId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/images/${listing.coverImageId}`}
                      alt=""
                      className="h-24 w-full object-cover"
                    />
                  ) : (
                    <div className="h-24 w-full bg-zinc-100" />
                  )}
                  <div className="p-2">
                    <p className="line-clamp-2 text-sm font-medium text-zinc-900">
                      {listing.title}
                    </p>
                    <p className="mt-1 text-sm text-zinc-600">
                      ${Number(listing.price).toFixed(2)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 11: Put the seller card on the listing detail**

In `c2c-e-commerce/src/app/(frontend)/listings/[id]/page.tsx`:

Add the import:

```tsx
import SellerCard from "@/components/reviews/SellerCard";
```

Remove the `Seller:` line from the details grid — the card says it better:

```tsx
            <p>
              <span className="font-medium text-zinc-900">Seller:</span>{" "}
              {listing.sellerName ?? `Seller #${listing.sellerId}`}
            </p>
```

and render the card between the listing section and `<SimilarListings />`, where the review block used to be:

```tsx
      <SellerCard
        sellerId={listing.sellerId}
        name={listing.sellerName}
        avatarUrl={listing.sellerAvatarUrl}
        reviewCount={listing.sellerReviewCount}
        ratingSum={listing.sellerRatingSum}
      />
```

- [ ] **Step 12: Put the affordance on the order detail**

In `c2c-e-commerce/src/app/(frontend)/orders/[id]/page.tsx`:

Add the import:

```tsx
import ReviewForm from "@/components/reviews/ReviewForm";
```

and render it after `<OrderActions … />`:

```tsx
      {/* Three conditions, all of them the server's rules restated: completed, this
          viewer's own purchase, and not already reviewed. Getting any of them wrong here
          produces a 403 or a 409 rather than a bad write — the endpoint decides. */}
      {actor === "buyer" && order.status === "completed" && order.reviewId === null && (
        <ReviewForm orderId={order.id} onSubmitted={refetch} />
      )}
```

`useFetch` already returns `refetch`; add it to the destructuring beside `data`, `setData`, `loading` and `error`.

- [ ] **Step 13: Run the component project, type-check and lint**

Run: `cd c2c-e-commerce && npx vitest run --project component && npx tsc --noEmit && npm run lint`
Expected: all pass. A `tsc` error naming `Review` means Step 1's type rename missed an importer.

- [ ] **Step 14: Run the whole suite**

Run: `cd c2c-e-commerce && npm test`
Expected: 0 failures; the count rises by 14.

- [ ] **Step 15: Commit**

```bash
git add c2c-e-commerce/src/components/reviews c2c-e-commerce/src/types/api.ts \
        "c2c-e-commerce/src/app/(frontend)/users" \
        "c2c-e-commerce/src/app/(frontend)/listings/[id]/page.tsx" \
        "c2c-e-commerce/src/app/(frontend)/orders/[id]/page.tsx"
git commit -m "feat(reviews): seller card, seller profile, and reviewing from the order"
```

---

### Task 9: Drop `reviews.listing_id`

Nothing has read it since Task 3 and nothing has written it since Task 2. This removes it.

**Files:**
- Create: `c2c-e-commerce/drizzle/0018_drop_review_listing_id.sql`
- Modify: `c2c-e-commerce/src/db/schema/reviews.ts`
- Modify: `c2c-e-commerce/src/db/schema/reviews-reanchor.integration.test.ts` (one assertion)

**Interfaces:**
- Consumes: the column state 0017 left.
- Produces: `Review` no longer has `listingId`, which changes `SellerReview` in `src/types/api.ts` by derivation — check that nothing named it.

- [ ] **Step 1: Prove nothing reads the column**

Run these three and read every hit before writing anything:

```bash
cd c2c-e-commerce
grep -rn "reviews\.listingId\|reviews\.listing_id" src/ drizzle/
grep -rn "listingId" src/components/reviews src/app/api/users src/app/api/reviews "src/app/api/orders/[id]/review"
grep -rn "review" drizzle/0018_drop_review_listing_id.sql 2>/dev/null || true
```

Expected from the first: hits only inside `drizzle/0000_initial_schema.sql`, `drizzle/0017_reviews_reanchor.sql` and `src/db/schema/reviews.ts` — the two migrations that created and re-anchored it, plus the model line this task removes. Any hit in a route, a component or a test is work Tasks 2–8 left behind; fix it here before continuing.

Expected from the second: only `listingId: null` inside `SellerReviews.component.test.tsx`'s fixture builder, which Step 4 removes.

- [ ] **Step 2: Write the migration**

Create `c2c-e-commerce/drizzle/0018_drop_review_listing_id.sql`:

```sql
-- Part 4 — the listing is reachable through the order now.
--
-- Deliberately separate from 0017 (spec §8, and the shape 0015/0016 used): every consumer
-- had to move to `order_id` first, and dropping the column in the additive migration would
-- have left the tree broken between tasks.
--
-- Recoverable in principle — `reviews.order_id -> orders.listing_id` gives the same value
-- back — but the column itself does not return, and a database that has run this cannot
-- run the code that read it.

ALTER TABLE "reviews" DROP COLUMN IF EXISTS "listing_id";
```

- [ ] **Step 3: Remove it from the model**

In `c2c-e-commerce/src/db/schema/reviews.ts`, delete the `listingId` field and the now-unused `listings` import.

- [ ] **Step 4: Remove the column from the one test fixture that names it**

In `c2c-e-commerce/src/components/reviews/SellerReviews.component.test.tsx`, remove `listingId: null,` from the fixture builder. `SellerReview` is derived from the row type, so it stops being a valid property here.

Leave `reviews-reanchor.integration.test.ts` alone. It applies migrations up to 0017 only — never 0018 — so its "still has listing_id, now nullable, for 0018 to drop" case is asserting the state 0017 leaves behind and must keep passing unchanged.

- [ ] **Step 5: Confirm the shared test database has actually dropped it**

The `integration` project applies every migration to its container, so this asserts the real end state. Add one case to `c2c-e-commerce/src/db/reviews.integration.test.ts`:

```ts
describe("0018", () => {
  it("has dropped listing_id from reviews", async () => {
    const db = await getTestDb();
    const result = await db.execute(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'reviews' AND column_name = 'listing_id'`,
    );

    expect(result.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Type-check, lint, and run the whole suite**

Run: `cd c2c-e-commerce && npx tsc --noEmit && npm run lint && npm test`
Expected: 0 failures; the count rises by 1.

- [ ] **Step 7: Commit**

```bash
git add c2c-e-commerce/drizzle/0018_drop_review_listing_id.sql \
        c2c-e-commerce/src/db/schema/reviews.ts \
        c2c-e-commerce/src/db/schema/reviews-reanchor.integration.test.ts \
        c2c-e-commerce/src/db/reviews.integration.test.ts \
        c2c-e-commerce/src/components/reviews/SellerReviews.component.test.tsx
git commit -m "feat(reviews): drop reviews.listing_id (0018)"
```

---

### Task 10: The documentation catches up

Spec §7 names this explicitly: `threat-model.test.ts` asserts the security docs cite real files, so it breaks the moment routes move, and `rbac-matrix.md` needs rows for the review endpoints. The Swagger `Review` schema is wrong in two ways that predate this part and one that this part introduced.

**Files:**
- Modify: `docs/security/rbac-matrix.md`
- Modify: `docs/security/threat-model.md`
- Modify: `c2c-e-commerce/scripts/generate-swagger.mjs`
- Modify: `c2c-e-commerce/src/lib/swagger-spec.json` (regenerated, never hand-edited)

**Interfaces:**
- Consumes: every endpoint Tasks 5–7 built.
- Produces: nothing.

- [ ] **Step 1: Update the RBAC matrix rows**

In `docs/security/rbac-matrix.md`, delete these two rows:

```
| `/api/listings/{id}/reviews` | GET | — | ✓ | ✓ | ✓ | — |
| `/api/listings/{id}/reviews` | POST | required | ✓ | ✓ | ✓ | Must be the buyer on a `completed` order for this listing |
```

Replace the `/api/reviews/{id}` row with:

```
| `/api/reviews/{id}` | PATCH · DELETE | required | author | author | ✓ | `canMutateReview`; **not** the seller being reviewed. Both verbs adjust the seller's aggregates in the same transaction |
```

Add these rows, keeping the file's path ordering (`/api/orders/…` before `/api/recommendations`, `/api/users/…` after `/api/users`):

```
| `/api/orders/{id}/review` | POST | required | buyer | buyer | ✗ | Buyer of *this* order, status `completed`. A non-party gets **404**; the seller and admins get **403** — reading an order is not a licence to write its buyer's opinion. One review per order, enforced by `reviews_one_per_order_idx` → **409** |
| `/api/users/{id}/reviews` | GET | — | ✓ | ✓ | ✓ | Public. Name, avatar and the two rating integers only — `GET /api/users/{id}` stays `isSelfOrAdmin` |
```

Add a bullet to **Known gaps**:

```
- **`GET /api/users/{id}/reviews` publishes a seller's display name and avatar to anyone.**
  That is what a marketplace profile is for (spec §6.4), and it is the reason the endpoint
  projects five columns by name rather than selecting the row. A `select *` there would
  publish the email address beside them; the route's own test asserts it does not.
```

Also update the first **Known gaps** bullet, which says `DELETE /api/users/{id}` cascades to reviews — it now cascades on two paths, as author and as subject:

```
- **`DELETE /api/users/{id}`** cascades to listings, orders and reviews — and since Part 4,
  to reviews on both sides: the ones they wrote and the ones written about them. Deleting a
  seller erases their reputation along with them. Intended, destructive, no soft delete;
  deferred.
```

- [ ] **Step 2: Update the threat model**

In `docs/security/threat-model.md`, find the **Information disclosure** threat and add the new public endpoint to its Mitigation, with a Proof that names a real test file:

```
`GET /api/users/{id}/reviews` is public by design and projects five columns off the users
row by name — id, name, avatar, and the two rating integers. The email address, phone
number and password hash are never in the projection, which is what makes a later
`select *` a test failure rather than a leak.

**Proof.** `src/app/api/users/[id]/reviews/route.integration.test.ts` — "never leaks
anything else off the users row".
```

Keep the existing `**Mitigation.**`/`**Proof.**` marker count unchanged: `threat-model.test.ts` counts one of each per threat section, so fold this into the existing markers rather than adding a second pair.

Then check the assets table near the top: the row reading `| Order and review data | Buyers' purchase history is personal |` is now half wrong, because a review is public and an order is not. Split the claim:

```
| Order data | Buyers' purchase history is personal |
| Review data | Public by design; the link to the order that proves it is not |
```

- [ ] **Step 3: Run the threat-model test**

Run: `cd c2c-e-commerce && npx vitest run --project unit src/test/threat-model.test.ts`
Expected: PASS. A failure naming a missing file means a path in the document is wrong — fix the document, not the test.

- [ ] **Step 4: Fix the Swagger `Review` schema**

In `c2c-e-commerce/scripts/generate-swagger.mjs`, replace the `Review` schema. It currently declares a `listingId` that Task 9 dropped and an `updatedAt` the table has never had:

```js
      Review: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          rating: { type: "integer", minimum: 1, maximum: 5, example: 4 },
          comment: { type: "string", nullable: true, example: "Great seller!" },
          reviewerId: { type: "integer", example: 3 },
          sellerId: { type: "integer", example: 5, description: "The user being reviewed" },
          orderId: {
            type: "integer",
            example: 9,
            description: "The transaction being reviewed; unique across reviews",
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
```

and update the tag description, which still says these are listing reviews:

```js
    { name: "Reviews", description: "Seller reviews & ratings" },
```

- [ ] **Step 5: Regenerate the spec**

Run: `cd c2c-e-commerce && node scripts/generate-swagger.mjs`
Expected: `✓ Swagger spec written to …/src/lib/swagger-spec.json`.

Never hand-edit `src/lib/swagger-spec.json`; it is generated.

- [ ] **Step 6: Verify the generated spec picked up the new routes**

```bash
cd c2c-e-commerce
grep -c "orders/{id}/review" src/lib/swagger-spec.json
grep -c "users/{id}/reviews" src/lib/swagger-spec.json
grep -c "listings/{id}/reviews" src/lib/swagger-spec.json
```

Expected: at least 1, at least 1, and **0**. A non-zero third count means the deleted route's JSDoc survives somewhere.

- [ ] **Step 7: Run the whole suite one last time**

Run: `cd c2c-e-commerce && npx tsc --noEmit && npm run lint && npm test`
Expected: 0 failures.

- [ ] **Step 8: Commit**

```bash
git add docs/security c2c-e-commerce/scripts/generate-swagger.mjs c2c-e-commerce/src/lib/swagger-spec.json
git commit -m "docs(reviews): rbac matrix, threat model and swagger follow the re-anchor"
```

---

## Done when

- `reviews` has `seller_id` and `order_id`, both `NOT NULL`, with a unique index on `order_id`; `listing_id` is gone.
- `users.review_count` and `users.rating_sum` are maintained in the same transaction as every insert, edit and delete of a review, and the migration's own backfill is proven by a test that replays it.
- `POST /api/orders/{id}/review` is the only way to create a review, and two concurrent posts on one order produce exactly one 201 and one 409.
- `GET /api/users/{id}/reviews` is public, paginated, and returns nothing off the users row but id, name, avatar and the two integers.
- `PATCH` and `DELETE /api/reviews/{id}` are author-or-admin and both move the aggregates.
- `GET`/`POST /api/listings/{id}/reviews` no longer exist and nothing references them.
- The listing page links to a seller profile; the order page is where a review is written; `/users/{id}` shows a rating, the reviews and that seller's active listings.
- `npx tsc --noEmit`, `npm run lint` and `npm test` are all clean, with a test count of roughly **1397 + 110**.
- `rbac-matrix.md`, `threat-model.md` and `swagger-spec.json` describe the endpoints that exist.
