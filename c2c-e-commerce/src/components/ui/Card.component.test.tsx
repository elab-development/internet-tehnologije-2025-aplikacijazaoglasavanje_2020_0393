/**
 * role="button" on a div containing a heading and nested buttons flattens the whole
 * card into one control in the accessibility tree. The footer's Disable and Delete
 * buttons become unreachable, and the h3 stops being a heading.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import Card from "./Card";

describe("Card — an openable card is a link", () => {
  it("exposes a link named by its title, not a button named by everything inside", () => {
    render(
      <Card
        title="Blue bicycle"
        description="$120.00"
        href="/listings/7"
        footer={<button>Delete</button>}
      />,
    );

    const link = screen.getByRole("link", { name: "Blue bicycle" });
    expect(link).toHaveAttribute("href", "/listings/7");
    expect(screen.queryByRole("button", { name: /Blue bicycle/ })).toBeNull();
  });

  it("keeps the title a heading", () => {
    render(<Card title="Blue bicycle" href="/listings/7" />);
    expect(screen.getByRole("heading", { name: "Blue bicycle" })).toBeInTheDocument();
  });

  it("leaves footer controls independently reachable", () => {
    render(
      <Card title="Blue bicycle" href="/listings/7" footer={<button>Delete</button>} />,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("renders no link at all when there is nowhere to go", () => {
    // This is how /listings and /orders already use it, and it was always correct.
    render(<Card title="Blue bicycle" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
