/**
 * C2C-SEC-10 spec — the ownership predicates.
 *
 * `authorize()` answers "what role is this?", which is only half the question. Whether
 * a seller may edit *this* listing, or a buyer read *this* order, was previously decided
 * ad hoc in each route — which is how `GET /api/listings` came to leak other sellers'
 * inventory. These predicates make the second half a single, testable decision.
 *
 * Pure functions over ids and roles: no database, so every combination is cheap to
 * cover, and the routes stay responsible only for fetching the row.
 */
import { describe, expect, it } from "vitest";

import type { TokenPayload } from "./auth";
import {
  canDeleteReview,
  canMutateListing,
  canViewOrder,
  isAdmin,
  isSelfOrAdmin,
  orderActorFor,
} from "./authorization";

const actor = (
  sub: number,
  role: TokenPayload["role"],
): TokenPayload => ({ sub, email: `u${sub}@example.test`, role });

const BUYER = actor(1, "buyer");
const SELLER = actor(2, "seller");
const OTHER_SELLER = actor(3, "seller");
const ADMIN = actor(4, "admin");

describe("C2C-SEC-10 — isAdmin / isSelfOrAdmin", () => {
  it("recognises only the admin role", () => {
    expect(isAdmin(ADMIN)).toBe(true);
    expect(isAdmin(SELLER)).toBe(false);
    expect(isAdmin(BUYER)).toBe(false);
  });

  it("lets a user act on their own record", () => {
    expect(isSelfOrAdmin(BUYER, BUYER.sub)).toBe(true);
  });

  it("stops a user acting on someone else's", () => {
    expect(isSelfOrAdmin(BUYER, SELLER.sub)).toBe(false);
  });

  it("lets an admin act on anyone", () => {
    expect(isSelfOrAdmin(ADMIN, BUYER.sub)).toBe(true);
  });
});

describe("C2C-SEC-10 AC2 — canMutateListing", () => {
  const listing = { sellerId: SELLER.sub };

  it("allows the owning seller", () => {
    expect(canMutateListing(SELLER, listing)).toBe(true);
  });

  it("refuses a different seller", () => {
    // The bug class this whole story exists for: role-authorised, not owner.
    expect(canMutateListing(OTHER_SELLER, listing)).toBe(false);
  });

  it("allows an admin", () => {
    expect(canMutateListing(ADMIN, listing)).toBe(true);
  });

  it("refuses a buyer even for a listing whose sellerId happens to match", () => {
    // Ids are per-table; a buyer with id 2 is not the seller with id 2.
    expect(canMutateListing(actor(2, "buyer"), listing)).toBe(false);
  });
});

describe("Part 3 — orderActorFor", () => {
  const order = { buyerId: BUYER.sub, sellerId: SELLER.sub };

  it("calls the buyer a buyer", () => {
    expect(orderActorFor(BUYER, order)).toBe("buyer");
  });

  it("calls the seller a seller", () => {
    expect(orderActorFor(SELLER, order)).toBe("seller");
  });

  it("calls an admin an admin, whichever side they are on", () => {
    expect(orderActorFor(ADMIN, order)).toBe("admin");
    expect(orderActorFor(ADMIN, { buyerId: ADMIN.sub, sellerId: SELLER.sub })).toBe("admin");
  });

  it("makes a stranger no party at all", () => {
    expect(orderActorFor(OTHER_SELLER, order)).toBeNull();
    expect(orderActorFor(actor(99, "buyer"), order)).toBeNull();
  });

  it("reads ids, not roles", () => {
    // A user whose role is `buyer` can still be the seller on an order they placed a
    // listing for — D5 makes everyone both. Gating on the role here would lock them out
    // of their own sale.
    const swapped = { buyerId: SELLER.sub, sellerId: BUYER.sub };
    expect(orderActorFor(BUYER, swapped)).toBe("seller");
    expect(orderActorFor(SELLER, swapped)).toBe("buyer");
  });

  it("prefers buyer when the same user is somehow both", () => {
    // The route refuses self-purchase, so this should not exist. If a row ever does, the
    // answer must be deterministic rather than whichever branch ran first.
    expect(orderActorFor(BUYER, { buyerId: BUYER.sub, sellerId: BUYER.sub })).toBe("buyer");
  });
});

describe("Part 3 — canViewOrder", () => {
  const order = { buyerId: BUYER.sub, sellerId: SELLER.sub };

  it("allows the buyer who placed it", () => {
    expect(canViewOrder(BUYER, order)).toBe(true);
  });

  it("allows the seller who is selling it", () => {
    // Changed by Part 3. The old rule refused sellers because an order was a basket that
    // could expose the buyer's other purchases. One order is now one listing this seller
    // already sells, so there is nothing left to hide from them.
    expect(canViewOrder(SELLER, order)).toBe(true);
  });

  it("allows an admin", () => {
    expect(canViewOrder(ADMIN, order)).toBe(true);
  });

  it("refuses everyone else", () => {
    expect(canViewOrder(OTHER_SELLER, order)).toBe(false);
    expect(canViewOrder(actor(99, "buyer"), order)).toBe(false);
  });
});

describe("C2C-SEC-10 AC6 — canDeleteReview", () => {
  const review = { reviewerId: BUYER.sub };

  it("allows the author", () => {
    expect(canDeleteReview(BUYER, review)).toBe(true);
  });

  it("refuses anyone else", () => {
    expect(canDeleteReview(actor(9, "buyer"), review)).toBe(false);
    expect(canDeleteReview(SELLER, review)).toBe(false);
  });

  it("allows an admin, for moderation", () => {
    expect(canDeleteReview(ADMIN, review)).toBe(true);
  });

  it("refuses the seller of the reviewed listing", () => {
    // Otherwise a seller could delete criticism of their own goods.
    expect(canDeleteReview(SELLER, { reviewerId: BUYER.sub })).toBe(false);
  });
});
