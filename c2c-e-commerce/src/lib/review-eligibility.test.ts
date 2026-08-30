import { describe, it, expect } from "vitest";
import {
  PURCHASED_ORDER_STATUSES,
  isPurchasedStatus,
} from "./review-eligibility";
import { orderStatusEnum } from "@/db/schema";

describe("PURCHASED_ORDER_STATUSES", () => {
  it("counts the statuses where money actually changed hands", () => {
    expect([...PURCHASED_ORDER_STATUSES].sort()).toEqual(
      ["completed", "confirmed", "shipped"].sort()
    );
  });

  it("excludes pending, because the seller has not accepted yet", () => {
    expect(isPurchasedStatus("pending")).toBe(false);
  });

  it("excludes the three ways a sale falls through", () => {
    expect(isPurchasedStatus("cancelled")).toBe(false);
    expect(isPurchasedStatus("declined")).toBe(false);
    expect(isPurchasedStatus("expired")).toBe(false);
  });

  it("only contains statuses the DB enum actually allows", () => {
    // Guards against a typo here silently making the check match nothing,
    // which would lock every buyer out of reviewing.
    for (const status of PURCHASED_ORDER_STATUSES) {
      expect(orderStatusEnum.enumValues).toContain(status);
    }
  });

  it("classifies every status the DB enum allows", () => {
    // If a new status is added to the enum, this forces a decision about
    // whether it counts as a purchase rather than defaulting silently.
    const classified = new Set<string>([
      ...PURCHASED_ORDER_STATUSES,
      "pending",
      "cancelled",
      "declined",
      "expired",
    ]);
    for (const status of orderStatusEnum.enumValues) {
      expect(classified).toContain(status);
    }
  });
});

describe("isPurchasedStatus", () => {
  it("accepts each purchased status", () => {
    for (const status of PURCHASED_ORDER_STATUSES) {
      expect(isPurchasedStatus(status)).toBe(true);
    }
  });
});
