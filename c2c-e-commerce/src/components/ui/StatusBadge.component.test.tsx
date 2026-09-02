/**
 * H13 spec — StatusBadge owns every buyer-facing status word in the app, and `status`
 * is typed `string` then cast into two typed maps — so `status="sold"` without
 * `kind="listing"` silently renders grey with no error anywhere. (L8 fixes the type in
 * Task 29; this pins the behaviour first.)
 *
 * Real enums, not invented values: order statuses from `src/lib/order-lifecycle.ts`
 * (`ORDER_STATUSES`), listing statuses from `src/db/schema/listings.ts`
 * (`listingStatusEnum`).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import StatusBadge from "./StatusBadge";

const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "completed",
  "cancelled",
  "declined",
  "expired",
] as const;

const LISTING_STATUSES = ["draft", "active", "reserved", "sold", "removed"] as const;

describe("StatusBadge", () => {
  // `getByText(/\w/)` would pass for any non-empty string, including a status the map
  // does not know. Assert the badge renders a label that is not the raw enum value,
  // which is what a missing map entry would leave behind.
  it.each(ORDER_STATUSES)("gives the order status %s a human label", (status) => {
    render(<StatusBadge status={status} kind="order" />);
    const label = screen.getByText(/\S/).textContent?.trim() ?? "";
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe(status);
  });

  it.each(ORDER_STATUSES)(
    "gives the order status %s a distinct descriptive label",
    (status) => {
      render(<StatusBadge status={status} kind="order" descriptive />);
      const label = screen.getByText(/\S/).textContent?.trim() ?? "";
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(status);
    },
  );

  it.each(LISTING_STATUSES)("gives the listing status %s a human label", (status) => {
    render(<StatusBadge status={status} kind="listing" />);
    const label = screen.getByText(/\S/).textContent?.trim() ?? "";
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe(status);
  });

  it("gives each order status a distinguishable label, not just a colour", () => {
    const labels = new Set(
      ORDER_STATUSES.map((status) => {
        const { unmount } = render(<StatusBadge status={status} kind="order" />);
        const text = screen.getByText(/\S/).textContent;
        unmount();
        return text;
      }),
    );
    expect(labels.size).toBe(ORDER_STATUSES.length);
  });

  it("gives each listing status a distinguishable label, not just a colour", () => {
    const labels = new Set(
      LISTING_STATUSES.map((status) => {
        const { unmount } = render(<StatusBadge status={status} kind="listing" />);
        const text = screen.getByText(/\S/).textContent;
        unmount();
        return text;
      }),
    );
    expect(labels.size).toBe(LISTING_STATUSES.length);
  });

  it("L8 — a listing status is not accepted as an order status", () => {
    // @ts-expect-error "sold" is a listing status; kind="order" must reject it.
    render(<StatusBadge status="sold" kind="order" />);
  });

  it("renders 'Unknown status' instead of a raw slug the map doesn't know", () => {
    // The union makes this case unreachable through normal typing — real drift
    // between the API's enum and this component's map is the only way to hit it,
    // so the test has to force its way past the type system to simulate that.
    render(<StatusBadge status={"awaiting_pickup" as never} kind="order" />);

    expect(screen.getByText("Unknown status")).toBeInTheDocument();
    expect(screen.queryByText("awaiting_pickup")).not.toBeInTheDocument();
  });
});
