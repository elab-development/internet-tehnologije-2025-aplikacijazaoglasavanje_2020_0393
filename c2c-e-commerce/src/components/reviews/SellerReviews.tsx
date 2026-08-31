"use client";

import StarRating from "./StarRating";
import type { SellerReview } from "@/types/api";

export type SellerReviewsProps = {
  reviews: SellerReview[];
};

/**
 * A seller's reviews.
 *
 * Purely presentational, which is the difference from the `ListingReviews` it replaces:
 * that component carried the submit form as well, because a listing page was both where
 * you read reviews and where you wrote one. Reviews are written against an order now, so
 * this list has no form, no `canReview` prop and no notion of who is reading it.
 */
export default function SellerReviews({ reviews }: SellerReviewsProps) {
  if (reviews.length === 0) {
    return <p className="text-sm text-zinc-500">No reviews yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {reviews.map((review) => (
        <li key={review.id}>
          <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {review.reviewerName ?? `Buyer #${review.reviewerId}`}
                </p>
                <p className="text-xs text-zinc-500">
                  {new Date(review.createdAt).toLocaleDateString()}
                </p>
              </div>
              <StarRating value={review.rating} size="sm" />
            </div>
            <p className="text-sm text-zinc-600">{review.comment || "No comment."}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}
