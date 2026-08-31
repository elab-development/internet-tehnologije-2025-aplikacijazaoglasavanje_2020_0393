"use client";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { Button, ErrorAlert, InputField, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { SellerReview } from "@/types/api";

export type ReviewFormProps = {
  /** The order being reviewed — the endpoint is keyed on it. */
  orderId: number;
  /** Called after a successful write, so the caller can refetch. */
  onSubmitted: () => void;
};

/**
 * "Leave a review", as a button and a modal.
 *
 * Posts to `/api/orders/{id}/review` because the order is the thing being reviewed.
 * Whether the caller is *allowed* to is the server's decision — this component is only
 * rendered when the order is completed, unreviewed and the viewer's own, and it reports
 * whatever the server says when that turns out to be stale.
 *
 * `loading={submitting}` on the submit button is the double-click guard: `Button`
 * disables itself while loading, and a disabled default button also suppresses implicit
 * submission on Enter. A second write would be refused by the unique index anyway — this
 * only stops someone being shown a 409 for double-clicking.
 */
export default function ReviewForm({ orderId, onSubmitted }: ReviewFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api.post<SellerReview>(`/api/orders/${orderId}/review`, { rating, comment });

      onSubmitted();
      setIsOpen(false);
      setComment("");
      setRating(5);
      toast.success("Review submitted!");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit review";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setIsOpen(true)}>
        Leave a review
      </Button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Review this seller">
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
                  className="text-2xl leading-none text-amber-500"
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
            placeholder="How did the sale go?"
          />

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit review
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
