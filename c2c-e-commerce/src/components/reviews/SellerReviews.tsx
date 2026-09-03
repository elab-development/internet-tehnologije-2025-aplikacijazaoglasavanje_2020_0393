"use client";

import { RiStarLine } from "@remixicon/react";

import StarRating from "./StarRating";
import { EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
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
    return (
      <EmptyState
        icon={<RiStarLine size={32} />}
        title="No reviews yet"
        description="Once a buyer reviews an order with this seller, it will show up here."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {reviews.map((review) => (
        <li key={review.id}>
          <article className="rounded-none border border-rule bg-white p-4 shadow-none">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">
                  {review.reviewerName ?? `Buyer #${review.reviewerId}`}
                </p>
                <p className="text-xs text-ink-3">
                  {formatDate(review.createdAt, { dateOnly: true })}
                </p>
              </div>
              <StarRating value={review.rating} size="sm" />
            </div>
            <p className="text-sm text-ink-2">{review.comment || "No comment."}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}
