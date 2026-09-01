/**
 * Price rendering was duplicated nine times and two of them already disagreed:
 * SimilarListings and RecommendedForYou rendered "120.00" with no currency symbol
 * while /listings rendered "$120.00" for the same listing. On a marketplace offering
 * four currencies that is ambiguous in a way that matters.
 *
 * The existing test missed it because it asserted getByText(/120/), which matches both.
 */
import { describe, expect, it } from "vitest";

import { formatPrice } from "./format";

describe("formatPrice", () => {
  it("renders exactly what the seven agreeing sites rendered before", () => {
    expect(formatPrice(120)).toBe("$120.00");
    expect(formatPrice(1500.5)).toBe("$1500.50");
    expect(formatPrice(0)).toBe("$0.00");
  });

  it("accepts the string form the API returns for numeric columns", () => {
    // Drizzle returns `numeric` as a string; every call site wrapped it in Number().
    expect(formatPrice("120.00")).toBe("$120.00");
    expect(formatPrice("1500.5")).toBe("$1500.50");
  });

  it("always shows two decimals", () => {
    expect(formatPrice(7.1)).toBe("$7.10");
    expect(formatPrice(7.999)).toBe("$8.00");
  });

  it("does not group thousands, matching the previous output", () => {
    // toLocaleString would render "1,500.50" here. Changing that is out of scope --
    // it would churn assertions across the suite for no user-visible gain.
    expect(formatPrice(1500.5)).toBe("$1500.50");
    expect(formatPrice(1500.5)).not.toContain(",");
  });

  it("renders a non-finite value as a visible placeholder, never as $NaN", () => {
    expect(formatPrice(Number.NaN)).toBe("$—");
    expect(formatPrice("not a price")).toBe("$—");
  });
});
