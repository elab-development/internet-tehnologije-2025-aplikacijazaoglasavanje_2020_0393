/**
 * The profile's review list, and the gap it used to leave.
 *
 * The page renders the seller's full `reviewCount` in its heading but fetched a single
 * page, so any seller with more reviews than the page size advertised a number the page
 * could not show and gave no way to reach the rest. These cases are that gap.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SellerReviewFeed from "./SellerReviewFeed";
import type { SellerReview } from "@/types/api";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: { get } }));

beforeEach(() => {
  get.mockReset();
});

const review = (id: number): SellerReview => ({
  id,
  reviewerId: 100 + id,
  sellerId: 2,
  orderId: 200 + id,
  rating: 5,
  comment: `Review number ${id}`,
  createdAt: "2026-08-01T10:00:00.000Z",
  reviewerName: `Buyer ${id}`,
});

const page = (ids: number[]) => ids.map(review);

describe("SellerReviewFeed", () => {
  it("renders the reviews it was given", () => {
    render(
      <SellerReviewFeed sellerId={2} initialReviews={page([1, 2])} total={2} pageSize={2} />,
    );

    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("offers a way forward when the count exceeds what is shown", () => {
    render(
      <SellerReviewFeed sellerId={2} initialReviews={page([1, 2])} total={5} pageSize={2} />,
    );

    expect(screen.getByRole("button", { name: "Show more reviews" })).toBeInTheDocument();
  });

  it("offers nothing when every review is already on the page", () => {
    render(
      <SellerReviewFeed sellerId={2} initialReviews={page([1, 2])} total={2} pageSize={2} />,
    );

    expect(screen.queryByRole("button", { name: "Show more reviews" })).toBeNull();
  });

  it("asks for the next page and appends it, keeping what was already read", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ data: page([3, 4]) });

    render(
      <SellerReviewFeed sellerId={2} initialReviews={page([1, 2])} total={4} pageSize={2} />,
    );
    await user.click(screen.getByRole("button", { name: "Show more reviews" }));

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
    expect(get).toHaveBeenCalledWith("/api/users/2/reviews?page=2&limit=2");
    // The first page is still there -- appending, not replacing.
    expect(screen.getByText("Review number 1")).toBeInTheDocument();
    expect(screen.getByText("Review number 4")).toBeInTheDocument();
  });

  it("stops offering more once the count is reached", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ data: page([3, 4]) });

    render(
      <SellerReviewFeed sellerId={2} initialReviews={page([1, 2])} total={4} pageSize={2} />,
    );
    await user.click(screen.getByRole("button", { name: "Show more reviews" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Show more reviews" })).toBeNull(),
    );
  });

  it("reports the server's message and keeps the button when a page fails", async () => {
    const user = userEvent.setup();
    get.mockRejectedValue(new Error("Internal server error"));

    render(
      <SellerReviewFeed sellerId={2} initialReviews={page([1, 2])} total={4} pageSize={2} />,
    );
    await user.click(screen.getByRole("button", { name: "Show more reviews" }));

    expect(await screen.findByText("Internal server error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show more reviews" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
});
