/**
 * Code review, Task 2 fix round 1 — a regression test for the ambiguous `reviews`
 * relation.
 *
 * After 0017 a user stands in two different relationships to `reviews`: the reviews they
 * wrote (`reviewerId`) and the reviews written about them (`sellerId`). A single
 * `usersRelations.reviews: many(reviews)` cannot resolve which `one(users)` on
 * `reviewsRelations` it pairs with — there are two, `reviewer` and `seller` — so Drizzle
 * throws "There are multiple relations between reviews and users. Please specify relation
 * name" the first time anything runs a relational query through it. No existing test ran
 * one, which is how this shipped unnoticed in the first place.
 *
 * This runs an actual `db.query.users.findFirst({ with: ... })` against the shared test
 * database in both directions, so the ambiguity — and the `relationName` fix — are
 * exercised for real rather than only type-checked.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { users } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeReview, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

describe("usersRelations — reviewsWritten and reviewsReceived resolve independently", () => {
  it("reviewsReceived finds the reviews a seller was the subject of", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });
    const review = await makeReview({ listingId: listing.id });

    const found = await db.query.users.findFirst({
      where: eq(users.id, seller.id),
      with: { reviewsReceived: true },
    });

    expect(found?.reviewsReceived).toHaveLength(1);
    expect(found?.reviewsReceived[0].id).toBe(review.id);
  });

  it("reviewsWritten finds the reviews a reviewer authored", async () => {
    const db = await getTestDb();
    const reviewer = await makeUser({ role: "buyer" });
    const review = await makeReview({ reviewerId: reviewer.id });

    const found = await db.query.users.findFirst({
      where: eq(users.id, reviewer.id),
      with: { reviewsWritten: true },
    });

    expect(found?.reviewsWritten).toHaveLength(1);
    expect(found?.reviewsWritten[0].id).toBe(review.id);
  });

  it("a user who is both a reviewer and a seller keeps the two lists separate", async () => {
    const db = await getTestDb();
    const person = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: person.id });

    // person sold something and was reviewed for it...
    const received = await makeReview({ listingId: listing.id });
    // ...and separately wrote a review of someone else's sale.
    const written = await makeReview({ reviewerId: person.id });

    const found = await db.query.users.findFirst({
      where: eq(users.id, person.id),
      with: { reviewsReceived: true, reviewsWritten: true },
    });

    expect(found?.reviewsReceived.map((r) => r.id)).toEqual([received.id]);
    expect(found?.reviewsWritten.map((r) => r.id)).toEqual([written.id]);
  });
});
