/**
 * Part 3 spec §5.3 — the status graph, exhaustively.
 *
 * ALLOWED is written out by hand rather than derived from the module under test: a test
 * that reads its expectations from the implementation asserts only that the
 * implementation equals itself.
 */
import { describe, expect, it } from "vitest";

import {
  ORDER_STATUSES,
  RESERVATION_HOURS,
  TERMINAL_ORDER_STATUSES,
  canTransition,
  isTerminalStatus,
  listingStatusAfter,
  type OrderActor,
  type OrderStatus,
} from "./order-lifecycle";

const ACTORS: OrderActor[] = ["buyer", "seller", "admin"];

/** Every legal (from, to, actor) triple in the spec's graph. Seventeen of 147. */
const ALLOWED: Array<[OrderStatus, OrderStatus, OrderActor]> = [
  // From pending: the seller confirms or declines, the buyer cancels.
  ["pending", "confirmed", "seller"],
  ["pending", "confirmed", "admin"],
  ["pending", "declined", "seller"],
  ["pending", "declined", "admin"],
  ["pending", "cancelled", "buyer"],
  ["pending", "cancelled", "admin"],
  // Expiry is a fact about the clock. Only an admin can assert it by hand.
  ["pending", "expired", "admin"],
  // From confirmed: the seller ships; either party can call the deal off.
  ["confirmed", "shipped", "seller"],
  ["confirmed", "shipped", "admin"],
  ["confirmed", "cancelled", "buyer"],
  ["confirmed", "cancelled", "seller"],
  ["confirmed", "cancelled", "admin"],
  // From shipped: the buyer confirms receipt; either party can still call it off.
  ["shipped", "completed", "buyer"],
  ["shipped", "completed", "admin"],
  ["shipped", "cancelled", "buyer"],
  ["shipped", "cancelled", "seller"],
  ["shipped", "cancelled", "admin"],
];

const isAllowed = (from: OrderStatus, to: OrderStatus, actor: OrderActor) =>
  ALLOWED.some(([f, t, a]) => f === from && t === to && a === actor);

describe("ORDER_STATUSES", () => {
  it("has dropped paid, approved and rejected", () => {
    expect(ORDER_STATUSES).not.toContain("paid");
    expect(ORDER_STATUSES).not.toContain("approved");
    expect(ORDER_STATUSES).not.toContain("rejected");
  });
});

describe("canTransition — every state x state x actor", () => {
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      for (const actor of ACTORS) {
        const expected = isAllowed(from, to, actor);
        it(`${actor}: ${from} -> ${to} is ${expected ? "allowed" : "refused"}`, () => {
          expect(canTransition(from, to, actor)).toBe(expected);
        });
      }
    }
  }
});

describe("canTransition — the rules the table encodes", () => {
  it("never lets a status transition to itself", () => {
    for (const status of ORDER_STATUSES) {
      for (const actor of ACTORS) {
        expect(canTransition(status, status, actor)).toBe(false);
      }
    }
  });

  it("lets nothing out of a terminal state, admin included", () => {
    for (const from of TERMINAL_ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        for (const actor of ACTORS) {
          expect(canTransition(from, to, actor)).toBe(false);
        }
      }
    }
  });

  it("refuses a buyer confirming their own purchase", () => {
    // Confirming your own order would let a buyer take the seller's decision for them.
    expect(canTransition("pending", "confirmed", "buyer")).toBe(false);
  });

  it("refuses a seller cancelling a pending order", () => {
    // A seller's refusal is `declined`, which is a different fact about the transaction.
    expect(canTransition("pending", "cancelled", "seller")).toBe(false);
  });

  it("refuses a buyer declining", () => {
    expect(canTransition("pending", "declined", "buyer")).toBe(false);
  });

  it("refuses buyer and seller marking an order expired", () => {
    expect(canTransition("pending", "expired", "buyer")).toBe(false);
    expect(canTransition("pending", "expired", "seller")).toBe(false);
  });

  it("refuses a seller marking an order completed", () => {
    // Receipt is the buyer's fact to report.
    expect(canTransition("shipped", "completed", "seller")).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("names the four the spec names", () => {
    expect([...TERMINAL_ORDER_STATUSES].sort()).toEqual(
      ["cancelled", "completed", "declined", "expired"].sort(),
    );
  });

  it("is false for the three live states", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("confirmed")).toBe(false);
    expect(isTerminalStatus("shipped")).toBe(false);
  });
});

describe("listingStatusAfter", () => {
  it("sells the listing on confirmation", () => {
    expect(listingStatusAfter("confirmed")).toBe("sold");
  });

  it("returns the listing to browse when the deal falls through", () => {
    expect(listingStatusAfter("declined")).toBe("active");
    expect(listingStatusAfter("cancelled")).toBe("active");
    expect(listingStatusAfter("expired")).toBe("active");
  });

  it("leaves the listing alone for shipping and completion", () => {
    // The listing is already `sold` by then; touching it again would be a lie about
    // when it sold.
    expect(listingStatusAfter("shipped")).toBeNull();
    expect(listingStatusAfter("completed")).toBeNull();
    expect(listingStatusAfter("pending")).toBeNull();
  });
});

describe("RESERVATION_HOURS", () => {
  it("is 48, per D3", () => {
    expect(RESERVATION_HOURS).toBe(48);
  });
});
