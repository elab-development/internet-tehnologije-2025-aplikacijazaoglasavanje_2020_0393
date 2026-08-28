// ─── Ownership ────────────────────────────────────────────────────────────────
// The half of access control that `authorize()` does not cover (C2C-SEC-10).
//
// `authorize("seller")` answers "is this caller a seller?" — necessary, and not
// sufficient. Whether they may edit *this* listing is a different question, and it was
// previously answered ad hoc in each route, or not at all. That is how `GET
// /api/listings` came to leak other sellers' sold and removed inventory: a filter that
// looked like a feature.
//
// These are pure predicates over ids and roles. Routes stay responsible for fetching
// the row and for choosing the status code; the decision itself lives here, once, where
// it can be exhaustively tested.

import type { TokenPayload } from "./auth";

/** Admins are unrestricted by design — the matrix documents this per route. */
export function isAdmin(actor: TokenPayload): boolean {
  return actor.role === "admin";
}

/**
 * The caller is acting on their own user record, or is an admin.
 *
 * Note this says nothing about *what* they may change: a user may edit their own name
 * and may not grant themselves a role. That distinction stays in the route, because it
 * is about fields rather than identity.
 */
export function isSelfOrAdmin(actor: TokenPayload, userId: number): boolean {
  return isAdmin(actor) || actor.sub === userId;
}

/**
 * Whether the caller may modify or delete a listing.
 *
 * The role check is part of the predicate, not an assumption about the caller: ids are
 * per-table, so a buyer whose user id happens to equal some listing's `sellerId` is not
 * that seller. Leaving the role out here would make that collision exploitable.
 */
export function canMutateListing(
  actor: TokenPayload,
  listing: { sellerId: number },
): boolean {
  if (isAdmin(actor)) return true;
  return actor.role === "seller" && actor.sub === listing.sellerId;
}

/**
 * Whether the caller may read an order.
 *
 * Sellers deliberately cannot: they see their sales through `/api/orders/seller`, which
 * scopes to their own listings. Letting a seller read an arbitrary order id would expose
 * buyers' other purchases.
 */
export function canViewOrder(
  actor: TokenPayload,
  order: { buyerId: number },
): boolean {
  if (isAdmin(actor)) return true;
  return actor.role === "buyer" && actor.sub === order.buyerId;
}

/**
 * Whether the caller may approve or reject an order.
 *
 * Buyers never can, including on their own order — approving your own purchase would let
 * a buyer mark it fulfilled without the seller ever agreeing. The seller must own at
 * least one listing in it; the route establishes that and passes the answer in.
 */
export function canApproveOrder(
  actor: TokenPayload,
  context: { ownsListingInOrder: boolean },
): boolean {
  if (isAdmin(actor)) return true;
  return actor.role === "seller" && context.ownsListingInOrder;
}

/**
 * Whether the caller may delete a review.
 *
 * The author, or an admin moderating. Explicitly not the seller of the reviewed
 * listing — otherwise a seller could delete criticism of their own goods, which is the
 * one deletion that would make the ratings worthless.
 */
export function canDeleteReview(
  actor: TokenPayload,
  review: { reviewerId: number },
): boolean {
  return isAdmin(actor) || actor.sub === review.reviewerId;
}

/**
 * Whether a refusal should hide the resource's existence.
 *
 * 403 tells the caller "this exists and is not yours", which for a sequential id is an
 * enumeration oracle: walk the ids, collect the 403s, learn how many orders the system
 * has and which are real. 404 tells them nothing they did not already know.
 *
 * Applied where the id is guessable *and* the resource is private to one user. Not
 * applied to listings, which are public objects — a 403 there discloses nothing that
 * `GET /api/listings` does not already publish.
 */
export const HIDE_EXISTENCE_MESSAGE = "Order not found";
