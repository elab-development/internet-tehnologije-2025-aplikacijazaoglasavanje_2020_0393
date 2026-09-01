/**
 * `ButtonProps` was a closed hand-written list, so it accepted no aria-* props. Every
 * component that needed one hand-rolled a raw <button> and re-implemented the focus
 * ring, disabled styling and hover states — 17 sites, 8 of them purely for ARIA.
 * The inversion this test pins: the design system's button is the accessible one.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Button from "./Button";

describe("Button — ARIA passthrough", () => {
  it("forwards aria-label to the rendered button", () => {
    render(<Button aria-label="Close dialog" />);
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });

  it("forwards aria-expanded and aria-controls", () => {
    render(<Button aria-expanded aria-controls="panel-1">Filters</Button>);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", "panel-1");
  });

  it("forwards aria-current, which the seller tabs need", () => {
    render(<Button aria-current="page">Listings</Button>);
    expect(screen.getByRole("button", { name: "Listings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("Button — the behaviour 37 call sites already rely on", () => {
  it("is disabled while loading, so a double submit cannot fire", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the narrowed type prop", () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("still renders the explanatory title on a disabled button", () => {
    render(<Button disabled title="Add at least one photo first">Publish</Button>);
    expect(screen.getByRole("button")).toHaveAttribute(
      "title",
      "Add at least one photo first",
    );
  });

  it("ignores a caller trying to re-enable a loading button", async () => {
    const onClick = vi.fn();
    render(<Button loading disabled={false} onClick={onClick}>Save</Button>);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
