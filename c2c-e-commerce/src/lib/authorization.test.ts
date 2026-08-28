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
  canApproveOrder,
  canDeleteReview,
  canMutateListing,
  canViewOrder,
  isAdmin,
  isSelfOrAdmin,
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

describe("C2C-SEC-10 AC3 — canViewOrder", () => {
  const order = { buyerId: BUYER.sub };

  it("allows the buyer who placed it", () => {
    expect(canViewOrder(BUYER, order)).toBe(true);
  });

  it("refuses another buyer", () => {
    expect(canViewOrder(actor(9, "buyer"), order)).toBe(false);
  });

  it("allows an admin", () => {
    expect(canViewOrder(ADMIN, order)).toBe(true);
  });

  it("refuses a seller, who reads their sales through /api/orders/seller", () => {
    expect(canViewOrder(SELLER, order)).toBe(false);
  });
});

describe("C2C-SEC-10 AC4/AC5 — canApproveOrder", () => {
  it("allows a seller who owns a listing in the order", () => {
    expect(canApproveOrder(SELLER, { ownsListingInOrder: true })).toBe(true);
  });

  it("refuses a seller who owns nothing in it", () => {
    expect(canApproveOrder(OTHER_SELLER, { ownsListingInOrder: false })).toBe(false);
  });

  it("AC5: refuses a buyer outright, even their own order", () => {
    // Approving your own purchase would let a buyer mark it fulfilled.
    expect(canApproveOrder(BUYER, { ownsListingInOrder: false })).toBe(false);
    expect(canApproveOrder(BUYER, { ownsListingInOrder: true })).toBe(false);
  });

  it("allows an admin regardless of ownership", () => {
    expect(canApproveOrder(ADMIN, { ownsListingInOrder: false })).toBe(true);
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
