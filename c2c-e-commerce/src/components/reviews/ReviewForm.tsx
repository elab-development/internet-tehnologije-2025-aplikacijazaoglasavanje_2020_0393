"use client";

import { useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { Button, ErrorAlert, InputField, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { CreatedReview } from "@/types/api";

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
  const starRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Roving tabindex means only the checked star is in the tab order, so the arrow-key
  // handler below has to move focus itself as it moves the selection — otherwise Tab would
  // land on a star that is no longer reachable by arrow keys.
  function selectRating(value: number) {
    setRating(value);
    starRefs.current[value - 1]?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api.post<CreatedReview>(`/api/orders/${orderId}/review`, { rating, comment });

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
            <span id="star-rating-label" className="block text-sm font-medium text-ink-2">
              Star rating
            </span>
            <div
              role="radiogroup"
              aria-labelledby="star-rating-label"
              className="flex items-center gap-1"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  ref={(el) => {
                    starRefs.current[value - 1] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={value === rating}
                  // Only the selected control stays in the tab order; arrow keys move
                  // within the group, which is the radio pattern users expect.
                  tabIndex={value === rating ? 0 : -1}
                  onClick={() => selectRating(value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      event.preventDefault();
                      selectRating(value === 5 ? 1 : value + 1);
                    }
                    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      event.preventDefault();
                      selectRating(value === 1 ? 5 : value - 1);
                    }
                  }}
                  className={[
                    "flex h-11 w-11 items-center justify-center leading-none",
                    value <= rating ? "text-ink" : "text-rule-strong",
                  ].join(" ")}
                  aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width={26}
                    height={26}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill={value <= rating ? "currentColor" : "none"}
                    stroke={value <= rating ? "none" : "currentColor"}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  >
                    <path d="m12 3.4 2.7 5.7 6.2.9-4.5 4.3 1.1 6.2-5.5-2.9-5.5 2.9 1.1-6.2-4.5-4.3 6.2-.9Z" />
                  </svg>
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
