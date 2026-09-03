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
import type { OrderActor } from "./order-lifecycle";

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
 * The caller's relationship to this order, or null if they have none.
 *
 * Ids, not roles. `canMutateListing` deliberately checks the role as well, because ids
 * are per-table there and a buyer whose user id happens to equal some listing's
 * `sellerId` is not that seller. Here both fields are user ids from the same table, and
 * D5 makes every user potentially both — so a role check would lock a seller out of the
 * purchase they made, or a buyer out of the sale they are making.
 *
 * Buyer wins if the same user is somehow both: the route refuses self-purchase, but a
 * predicate must still be deterministic rather than order-of-evaluation dependent.
 */
export function orderActorFor(
  actor: TokenPayload,
  order: { buyerId: number; sellerId: number },
): OrderActor | null {
  if (isAdmin(actor)) return "admin";
  if (actor.sub === order.buyerId) return "buyer";
  if (actor.sub === order.sellerId) return "seller";
  return null;
}

/**
 * Whether the caller may read an order.
 *
 * Both parties and admins. Everyone else gets a 404 rather than a 403 — order ids are
 * sequential, so confirming existence is an enumeration oracle.
 */
export function canViewOrder(
  actor: TokenPayload,
  order: { buyerId: number; sellerId: number },
): boolean {
  return orderActorFor(actor, order) !== null;
}

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
