/**
 * Price rendering was duplicated nine times and two of them already disagreed:
 * SimilarListings and RecommendedForYou rendered "120.00" with no currency symbol
 * while /listings rendered "$120.00" for the same listing. On a marketplace offering
 * four currencies that is ambiguous in a way that matters.
 *
 * The existing test missed it because it asserted getByText(/120/), which matches both.
 */
import { describe, expect, it } from "vitest";

import { avatarUrl, formatDate, formatPrice } from "./format";

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

describe("formatDate", () => {
  it("L18 — formats a date one way", () => {
    expect(formatDate("2026-09-01T10:30:00Z")).toBe(
      formatDate(new Date("2026-09-01T10:30:00Z")),
    );
    expect(formatDate("2026-09-01T10:30:00Z")).toMatch(/2026/);
  });

  it("L18 fix round 1 — defaults to date+time, matching toLocaleString", () => {
    const value = "2026-09-01T10:30:00Z";
    expect(formatDate(value)).toBe(new Date(value).toLocaleString());
    // A transactional timestamp (order placed, reservation expires) carries a time
    // component -- that is the point of the four sites this default matches.
    expect(formatDate(value)).toContain(":");
  });

  it("L18 fix round 1 — dateOnly renders just the date, matching toLocaleDateString", () => {
    const value = "2026-09-01T10:30:00Z";
    expect(formatDate(value, { dateOnly: true })).toBe(new Date(value).toLocaleDateString());
    // A review is a low-precision human event -- no time component, and shorter than
    // the default form.
    expect(formatDate(value, { dateOnly: true })).not.toContain(":");
    expect(formatDate(value, { dateOnly: true }).length).toBeLessThan(formatDate(value).length);
  });

  it("L18 fix round 1 — accepts a Date the same way in both forms", () => {
    const value = new Date("2026-09-01T10:30:00Z");
    expect(formatDate(value, { dateOnly: true })).toBe(formatDate(value.toISOString(), { dateOnly: true }));
  });
});

describe("avatarUrl", () => {
  it("L19 — is stable and unique per user id", () => {
    expect(avatarUrl(42)).toBe(avatarUrl(42));
    expect(avatarUrl(42)).not.toBe(avatarUrl(7));
  });

  it("seeds the generated avatar on the user id", () => {
    expect(avatarUrl(42)).toContain("seed=42");
  });
});
