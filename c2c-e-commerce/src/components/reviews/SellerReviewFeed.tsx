"use client";

import { useState } from "react";

import SellerReviews from "./SellerReviews";
import { Button, ErrorAlert } from "@/components/ui";
import { api } from "@/lib/api";
import type { SellerReview, SellerReviewsResponse } from "@/types/api";

export type SellerReviewFeedProps = {
  sellerId: number;
  /** The first page, already fetched by the page so the profile renders in one paint. */
  initialReviews: SellerReview[];
  /** The seller's full review count, straight from the denormalised counter (D7). */
  total: number;
  /** Must match the `limit` the first page was fetched with, or page 2 skips rows. */
  pageSize: number;
};

/**
 * A seller's reviews, with a way to reach the ones past the first page.
 *
 * The profile used to fetch a single page and render the *total* in its heading, so a
 * seller with more reviews than the page size advertised a number the page could not
 * show and offered no way to get to the rest. The count was never wrong — it comes from
 * `users.review_count` — the page simply stopped short of it.
 *
 * Appending rather than replacing: someone reading down a list of reviews should not have
 * the ones they have already read disappear.
 */
export default function SellerReviewFeed({
  sellerId,
  initialReviews,
  total,
  pageSize,
}: SellerReviewFeedProps) {
  const [reviews, setReviews] = useState(initialReviews);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMore = reviews.length < total;

  async function showMore() {
    setError(null);
    setLoading(true);

    try {
      const next = await api.get<SellerReviewsResponse>(
        `/api/users/${sellerId}/reviews?page=${page + 1}&limit=${pageSize}`,
      );
      setReviews((current) => [...current, ...next.data]);
      setPage((current) => current + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load more reviews");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <SellerReviews reviews={reviews} />

      {error && <ErrorAlert message={error} />}

      {hasMore && (
        <Button variant="secondary" onClick={showMore} loading={loading}>
          Show more reviews
        </Button>
      )}
    </div>
  );
}
