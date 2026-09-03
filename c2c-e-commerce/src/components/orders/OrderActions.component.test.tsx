/**
 * Part 3 spec §5.3 — the buttons follow the graph.
 *
 * The component holds no rules of its own: it asks `canTransition` what this actor may
 * do from this status, so a change to the graph cannot leave the UI offering something
 * the API refuses.
 */
import { render, screen, within } from "@testing-library/react";
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

    // "Decline order" is destructive (H4): the first click only opens the confirmation
    // dialog, so the transition is driven from the dialog's own confirm button.
    await userEvent.click(screen.getByRole("button", { name: "Decline order" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Decline order" }),
    );

    expect(onTransition).toHaveBeenCalledWith("declined");
  });

  it("disables every button while one is in flight", () => {
    render(<OrderActions status="pending" actor="seller" busy onTransition={vi.fn()} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});

describe("H4 — terminal transitions ask first", () => {
  it("does not decline on the first click", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="seller" onTransition={onTransition} />);

    await user.click(screen.getByRole("button", { name: "Decline order" }));

    expect(onTransition).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /decline this order/i })).toBeInTheDocument();
  });

  it("declines once confirmed in the dialog", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="seller" onTransition={onTransition} />);

    await user.click(screen.getByRole("button", { name: "Decline order" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Decline order" }),
    );

    expect(onTransition).toHaveBeenCalledWith("declined");
  });

  it("abandons the transition when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="buyer" onTransition={onTransition} />);

    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    await user.keyboard("{Escape}");

    expect(onTransition).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still fires non-destructive transitions on one click", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="seller" onTransition={onTransition} />);

    await user.click(screen.getByRole("button", { name: "Confirm order" }));

    expect(onTransition).toHaveBeenCalledWith("confirmed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
