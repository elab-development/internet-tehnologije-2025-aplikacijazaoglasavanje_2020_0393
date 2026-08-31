/**
 * Part 4 spec §6.4 — the stars.
 *
 * Display only. The rating it shows is derived from two integers server-side (D7), so
 * this component's whole job is to render a number honestly — including the case where
 * there is no number, which is not the same as zero.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StarRating from "./StarRating";

describe("StarRating", () => {
  it("fills the nearest whole number of stars", () => {
    render(<StarRating value={4.2} />);
    expect(screen.getByLabelText("Rated 4.2 out of 5")).toBeInTheDocument();
  });

  it("rounds up at the halfway point", () => {
    render(<StarRating value={3.5} />);
    expect(screen.getByLabelText("Rated 3.5 out of 5")).toBeInTheDocument();
  });

  it("says there is no rating rather than showing zero stars", () => {
    // Zero stars reads as five one-star reviews. A seller who has never sold anything has
    // no rating at all, which is a different statement.
    render(<StarRating value={null} />);
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Rated/)).toBeNull();
  });

  it("shows the review count when given one", () => {
    render(<StarRating value={5} count={12} />);
    expect(screen.getByText("(12)")).toBeInTheDocument();
  });

  it("renders one star per point, always five", () => {
    const { container } = render(<StarRating value={2} />);
    expect(container.querySelectorAll("[data-star]")).toHaveLength(5);
  });
});
