/**
 * Part 3 spec §5.3 — the buttons follow the graph.
 *
 * The component holds no rules of its own: it asks `canTransition` what this actor may
 * do from this status, so a change to the graph cannot leave the UI offering something
 * the API refuses.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import OrderActions from "./OrderActions";

describe("OrderActions — a pending order", () => {
  it("offers the seller confirm and decline, and nothing else", () => {
    render(<OrderActions status="pending" actor="seller" onTransition={vi.fn()} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Confirm order",
      "Decline order",
    ]);
  });

  it("offers the buyer only cancel", () => {
    render(<OrderActions status="pending" actor="buyer" onTransition={vi.fn()} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Cancel order",
    ]);
  });

  it("never offers the buyer a way to confirm their own purchase", () => {
    render(<OrderActions status="pending" actor="buyer" onTransition={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Confirm order" })).toBeNull();
  });
});

describe("OrderActions — later states", () => {
  it("offers the seller shipping and cancellation once confirmed", () => {
    render(<OrderActions status="confirmed" actor="seller" onTransition={vi.fn()} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Mark as shipped",
      "Cancel order",
    ]);
  });

  it("offers the buyer receipt once shipped", () => {
    render(<OrderActions status="shipped" actor="buyer" onTransition={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Mark as received" })).toBeInTheDocument();
  });

  it("offers nothing at all on a terminal order", () => {
    for (const status of ["completed", "cancelled", "declined", "expired"] as const) {
      const { unmount } = render(
        <OrderActions status={status} actor="admin" onTransition={vi.fn()} />,
      );
      expect(screen.queryAllByRole("button"), status).toHaveLength(0);
      unmount();
    }
  });
});

describe("OrderActions — behaviour", () => {
  it("reports the status it is asking for", async () => {
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="seller" onTransition={onTransition} />);

    await userEvent.click(screen.getByRole("button", { name: "Decline order" }));

    expect(onTransition).toHaveBeenCalledWith("declined");
  });

  it("disables every button while one is in flight", () => {
    render(<OrderActions status="pending" actor="seller" busy onTransition={vi.fn()} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
