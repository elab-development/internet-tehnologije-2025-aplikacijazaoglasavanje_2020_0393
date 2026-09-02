/**
 * Part 4 spec §6.4 — the review list.
 *
 * Presentational. Submitting moved to the order page, so this component has no form, no
 * `canReview` prop and no idea who is looking at it.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SellerReviews from "./SellerReviews";
import type { SellerReview } from "@/types/api";

const review = (overrides: Partial<SellerReview> = {}): SellerReview => ({
  id: 1,
  reviewerId: 7,
  sellerId: 2,
  orderId: 11,
  rating: 5,
  comment: "Packed well.",
  createdAt: "2026-08-01T10:00:00.000Z",
  reviewerName: "Ada",
  ...overrides,
});

describe("SellerReviews", () => {
  it("renders one entry per review", () => {
    render(<SellerReviews reviews={[review({ id: 1 }), review({ id: 2 })]} />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("shows the reviewer's name and their comment", () => {
    render(<SellerReviews reviews={[review({ reviewerName: "Grace", comment: "Fast." })]} />);
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("Fast.")).toBeInTheDocument();
  });

  it("falls back to the reviewer's id when the name is missing", () => {
    render(<SellerReviews reviews={[review({ reviewerName: null, reviewerId: 42 })]} />);
    expect(screen.getByText("Buyer #42")).toBeInTheDocument();
  });

  it("says so when a review has no comment", () => {
    render(<SellerReviews reviews={[review({ comment: null })]} />);
    expect(screen.getByText("No comment.")).toBeInTheDocument();
  });

  it("shows an empty state rather than a bare heading", () => {
    render(<SellerReviews reviews={[]} />);
    expect(screen.getByRole("heading", { name: /no reviews yet/i })).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("L16 — shows an empty state when a seller has no reviews", async () => {
    render(<SellerReviews reviews={[]} />);
    expect(await screen.findByText(/no reviews yet/i)).toBeInTheDocument();
  });
});
