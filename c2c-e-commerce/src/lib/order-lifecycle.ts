// ─── The order status graph ───────────────────────────────────────────────────
// Part 3 of the 2026-08-30 redesign (spec §5.3).
//
// The old enum had seven values, no transition graph, and two ways to say the same
// thing. Review eligibility keyed off a hand-maintained subset of it — a comment
// pretending to be a rule.
//
// This module is the rule. It is pure, in the same shape as `authorization.ts`: routes
// fetch the row and choose the status code, the decision itself lives here once, where
// every state x state x actor combination is a unit test rather than a database round
// trip.

/**
 * Every status an order can hold.
 *
 * `paid` is gone: no flow ever set it and there is no payment integration, so it has
 * only ever been a lie. `approved`/`rejected` are `confirmed`/`declined` — the same
 * facts under names that say who decided.
 *
 * `expired` is a seventh state on purpose. The complaint about the old enum was
 * overlapping meanings, not the count: telling a buyer their order was "cancelled" when
 * they cancelled nothing is exactly the overlap being removed.
 */
export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "completed",
  "cancelled",
  "declined",
  "expired",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The caller's relationship to *this* order — not their role.
 *
 * A seller who did not sell this listing is not "seller" here, they are not a party at
 * all. Routes resolve this with `orderActorFor` in `authorization.ts`.
 */
export type OrderActor = "buyer" | "seller" | "admin";

/** Statuses nothing transitions out of. */
export const TERMINAL_ORDER_STATUSES = [
  "completed",
  "cancelled",
  "declined",
  "expired",
] as const satisfies readonly OrderStatus[];

export function isTerminalStatus(status: OrderStatus): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly string[]).includes(status);
}

/** How long a reservation holds a listing before it lapses (D3). */
export const RESERVATION_HOURS = 48;

/**
 * The graph, as data.
 *
 * Read it as "from this state, this transition is available, and these are the parties
 * who may drive it". An admin may drive any transition that is *legal*, so they are not
 * listed: `canTransition` adds them. The empty array on `pending -> expired` is
 * therefore meaningful rather than redundant — the transition exists, and no ordinary
 * party may assert it, because expiry is a fact about the clock.
 *
 * Terminal states map to an empty object, which is what makes them terminal.
 */
const TRANSITIONS: Record<
  OrderStatus,
  Partial<Record<OrderStatus, readonly OrderActor[]>>
> = {
  pending: {
    confirmed: ["seller"],
    declined: ["seller"],
    // From pending the buyer cancels; the seller's refusal is `declined`, which says
    // something different about the transaction.
    cancelled: ["buyer"],
    expired: [],
  },
  confirmed: {
    shipped: ["seller"],
    // After acceptance a deal can fall through on either side.
    cancelled: ["buyer", "seller"],
  },
  shipped: {
    completed: ["buyer"],
    cancelled: ["buyer", "seller"],
  },
  completed: {},
  cancelled: {},
  declined: {},
  expired: {},
};

/** Whether `actor` may move an order from `from` to `to`. */
export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
): boolean {
  const parties = TRANSITIONS[from][to];
  // `undefined` means the edge does not exist; `[]` means it exists but only an admin
  // may drive it. Testing `!parties` rather than truthiness of length keeps those apart.
  if (parties === undefined) return false;
  return actor === "admin" || parties.includes(actor);
}

/**
 * What the listing becomes when an order reaches `to`, or null to leave it alone.
 *
 * The caller applies this inside the same transaction as the status change: a listing
 * whose reservation was released by a committed transaction that then failed to release
 * it is exactly the state this part exists to make impossible.
 */
export function listingStatusAfter(to: OrderStatus): "active" | "sold" | null {
  switch (to) {
    case "confirmed":
      return "sold";
    case "declined":
    case "cancelled":
    case "expired":
      return "active";
    // Shipping and completion say nothing new about availability: the listing has been
    // `sold` since the confirmation.
    case "pending":
    case "shipped":
    case "completed":
      return null;
  }
}
