"use client";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { Button, ErrorAlert, InputField, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { Review } from "@/types/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ListingReviewsProps = {
  listingId: number;
  reviews: Review[];
  /** Whether the current user is allowed to leave a review. */
  canReview: boolean;
  /** Called after a review is created so the caller can reload the list. */
  onReviewCreated: () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarUrl(review: Review): string {
  const seed = review.reviewerName ?? `user-${review.reviewerId}`;
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** The reviews section of a listing, including the "write a review" modal. */
export default function ListingReviews({
  listingId,
  reviews,
  canReview,
  onReviewCreated,
}: ListingReviewsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      setError("Rating must be between 1 and 5");
      return;
    }

    setSubmitting(true);

    try {
      await api.post<Review>(`/api/listings/${listingId}/reviews`, {
        comment: comment.trim(),
        rating,
      });

      onReviewCreated();
      setIsModalOpen(false);
      setComment("");
      setRating(5);
      toast.success("Review submitted!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit review";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-zinc-900">Reviews</h2>

      {reviews.length === 0 ? (
        <p className="text-sm text-zinc-500">No reviews yet.</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <article
              key={review.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-2 flex items-center gap-2">
                <img
                  src={avatarUrl(review)}
                  alt={review.reviewerName ?? `User ${review.reviewerId}`}
                  className="h-8 w-8 rounded-full border border-zinc-200 bg-zinc-50"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    {review.reviewerName ?? `Buyer #${review.reviewerId}`}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {new Date(review.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <p className="text-sm font-medium text-zinc-900">
                Rating: {review.rating}/5
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                {review.comment || "No comment."}
              </p>
            </article>
          ))}
        </div>
      )}

      {canReview && (
        <Button variant="secondary" onClick={() => setIsModalOpen(true)}>
          Write a review
        </Button>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Submit review"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <ErrorAlert message={error} />}

          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-700">Star rating</p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  className="text-2xl leading-none"
                  aria-label={`Set rating to ${value}`}
                >
                  {value <= rating ? "★" : "☆"}
                </button>
              ))}
            </div>
          </div>

          <InputField
            label="Comment"
            type="text"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Share your experience"
          />

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit review
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
