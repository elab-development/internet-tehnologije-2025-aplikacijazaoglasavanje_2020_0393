import { describe, it, expect } from "vitest";
import { resolveListingVisibility } from "./listing-visibility";
import type { TokenPayload } from "@/lib/auth";

const anonymous = null;
const seller7: TokenPayload = { sub: 7, email: "s7@example.com", role: "seller" };
const seller9: TokenPayload = { sub: 9, email: "s9@example.com", role: "seller" };
const buyer: TokenPayload = { sub: 4, email: "b@example.com", role: "buyer" };
const admin: TokenPayload = { sub: 1, email: "a@example.com", role: "admin" };

// ─── Regression tests for the two disclosure bugs ─────────────────────────────

describe("regression: non-numeric sellerId must not drop every filter", () => {
  // Previously `conditions` was seeded from the raw string being truthy, so
  // `?sellerId=abc` produced an empty WHERE clause and returned the whole table.
  for (const raw of ["abc", "  ", "!", "null", "undefined", "NaN", "1e", "--1"]) {
    it(`restricts to active listings for sellerId=${JSON.stringify(raw)}`, () => {
      const result = resolveListingVisibility(raw, anonymous);
      expect(result.includeAllStatuses).toBe(false);
      expect(result.sellerFilter).toBeNull();
    });
  }

  it("restricts to active listings when sellerId is absent entirely", () => {
    expect(resolveListingVisibility(null, anonymous)).toEqual({
      includeAllStatuses: false,
      sellerFilter: null,
    });
  });
});

describe("regression: another seller's private inventory stays private", () => {
  it("hides non-active listings from anonymous callers", () => {
    const result = resolveListingVisibility("7", anonymous);
    expect(result.includeAllStatuses).toBe(false);
    expect(result.sellerFilter).toBe(7);
  });

  it("hides non-active listings from a different seller", () => {
    const result = resolveListingVisibility("7", seller9);
    expect(result.includeAllStatuses).toBe(false);
    expect(result.sellerFilter).toBe(7);
  });

  it("hides non-active listings from a buyer", () => {
    const result = resolveListingVisibility("7", buyer);
    expect(result.includeAllStatuses).toBe(false);
    expect(result.sellerFilter).toBe(7);
  });
});

// ─── Intended behaviour ───────────────────────────────────────────────────────

describe("a seller viewing their own dashboard", () => {
  it("sees every status, scoped to themselves", () => {
    expect(resolveListingVisibility("7", seller7)).toEqual({
      includeAllStatuses: true,
      sellerFilter: 7,
    });
  });

  it("is still restricted to active listings when browsing without a sellerId", () => {
    expect(resolveListingVisibility(null, seller7)).toEqual({
      includeAllStatuses: false,
      sellerFilter: null,
    });
  });
});

describe("admin", () => {
  // Deliberate per commit 8e5d326: the admin dashboard reuses the seller
  // dashboard and is expected to list every seller's inventory.
  it("sees all sellers and all statuses when a sellerId is supplied", () => {
    expect(resolveListingVisibility("7", admin)).toEqual({
      includeAllStatuses: true,
      sellerFilter: null,
    });
  });

  it("sees only active listings when browsing the public marketplace", () => {
    expect(resolveListingVisibility(null, admin)).toEqual({
      includeAllStatuses: false,
      sellerFilter: null,
    });
  });

  it("is not tricked into all-statuses by a non-numeric sellerId", () => {
    expect(resolveListingVisibility("abc", admin)).toEqual({
      includeAllStatuses: false,
      sellerFilter: null,
    });
  });
});

// ─── Parsing edge cases ───────────────────────────────────────────────────────

describe("sellerId parsing", () => {
  it("accepts a plain integer", () => {
    expect(resolveListingVisibility("42", anonymous).sellerFilter).toBe(42);
  });

  it("rejects trailing characters rather than prefix-parsing them", () => {
    // parseInt would read "7abc" as 7 and "1e" as 1. We treat both as absent so
    // a malformed filter can never be silently reinterpreted as a valid one.
    expect(resolveListingVisibility("7abc", anonymous).sellerFilter).toBeNull();
    expect(resolveListingVisibility("1e", anonymous).sellerFilter).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveListingVisibility(" 42 ", anonymous).sellerFilter).toBe(42);
  });

  it("treats a negative id as an ordinary filter that matches nothing", () => {
    const result = resolveListingVisibility("-3", anonymous);
    expect(result.sellerFilter).toBe(-3);
    expect(result.includeAllStatuses).toBe(false);
  });

  it("does not confuse seller id 0 with an absent filter", () => {
    // Guards against a `if (sellerId)` style regression, where 0 is falsy.
    const result = resolveListingVisibility("0", anonymous);
    expect(result.sellerFilter).toBe(0);
  });
});
