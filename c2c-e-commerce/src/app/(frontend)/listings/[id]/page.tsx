"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Button from "@/components/ui/Button";
import InputField from "@/components/ui/InputField";
import Modal from "@/components/ui/Modal";
import { ListingDetailSkeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
import { api } from "@/lib/api";

type Listing = {
  id: number;
  title: string;
  description: string;
  price: string;
  sellerId: number;
  categoryId: number | null;
  status: "active" | "sold" | "removed";
  sellerName: string | null;
  categoryName: string | null;
};

type Category = {
  id: number;
  name: string;
};

type Review = {
  id: number;
  reviewerId: number;
  listingId: number;
  rating: number;
  comment: string | null;
  reviewerName: string | null;
  createdAt: string;
};

type CreatedOrder = {
  id: number;
};

type Props = {
  params: Promise<{ id: string }>;
};

export default function ListingDetailPage({ params }: Props) {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();

  const [listingId, setListingId] = useState<number | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [orderSuccessId, setOrderSuccessId] = useState<number | null>(null);

  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState(5);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const {
    selectedCurrency,
    setSelectedCurrency,
    loadingRates,
    ratesError,
    availableCurrencies,
    formatConverted,
  } = useCurrencyConversion();

  const canReview = isAuthenticated && user?.role === "buyer";

  const categoryName = useMemo(() => {
    if (listing?.categoryName) return listing.categoryName;
    if (!listing?.categoryId) return "Uncategorized";
    const category = categories.find((item) => item.id === listing.categoryId);
    return category?.name ?? "Uncategorized";
  }, [categories, listing]);

  async function fetchReviews(idNum: number) {
    const reviewData = await api.get<Review[]>(`/api/listings/${idNum}/reviews`);
    setReviews(reviewData);
  }

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const resolvedParams = await params;
        const idNum = Number(resolvedParams.id);

        if (!Number.isInteger(idNum) || idNum <= 0) {
          if (alive) {
            setError("Invalid listing id");
            setLoading(false);
          }
          return;
        }

        if (!alive) return;
        setListingId(idNum);
        setLoading(true);
        setError(null);

        const [listingData, categoryData] = await Promise.all([
          api.get<Listing>(`/api/listings/${idNum}`),
          api.get<Category[]>("/api/categories"),
        ]);

        if (!alive) return;

        setListing(listingData);
        setCategories(categoryData);
        await fetchReviews(idNum);
      } catch (err: unknown) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load listing");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [params]);

  async function handleBuyNow() {
    if (!listingId) return;

    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    if (user?.role !== "buyer") {
      setError("Only buyers can place orders");
      return;
    }

    setBuying(true);
    setError(null);

    try {
      const order = await api.post<CreatedOrder>("/api/orders", {
        items: [{ listingId }],
      });

      setOrderSuccessId(order.id);
      setIsBuyModalOpen(false);
      toast.success(`Order #${order.id} placed successfully! 🎉`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create order";
      setError(msg);
      toast.error(msg);
    } finally {
      setBuying(false);
    }
  }

  async function handleSubmitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!listingId) return;

    setReviewError(null);
    setReviewSubmitting(true);

    try {
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        setReviewError("Rating must be between 1 and 5");
        return;
      }

      await api.post<Review>(`/api/listings/${listingId}/reviews`, {
        comment: comment.trim(),
        rating,
      });

      await fetchReviews(listingId);
      setIsReviewModalOpen(false);
      setComment("");
      setRating(5);
      toast.success("Review submitted!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit review";
      setReviewError(msg);
      toast.error(msg);
    } finally {
      setReviewSubmitting(false);
    }
  }

  if (loading) {
    return <ListingDetailSkeleton />;
  }
  if (error || !listing) {
    return (
      <div className="space-y-4">
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="shrink-0 mt-0.5">⚠️</span>
          <span>{error ?? "Listing not found"}</span>
        </div>
        <Button variant="secondary" onClick={() => router.push("/listings")}>Back to listings</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {orderSuccessId && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="shrink-0 text-base">✅</span>
          <div className="flex flex-col gap-1">
            <p className="font-semibold">Order placed successfully!</p>
            <p>Order ID: <span className="font-mono font-bold">#{orderSuccessId}</span></p>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4">
          <span className="inline-flex w-fit rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
            {categoryName}
          </span>
          <h1 className="text-2xl font-bold text-zinc-900">{listing.title}</h1>
          <p className="text-zinc-600">{listing.description}</p>

          <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
            <p>
              <span className="font-medium text-zinc-900">Price:</span> ${Number(listing.price).toFixed(2)}
            </p>
            <p>
              <span className="font-medium text-zinc-900">Converted:</span> {formatConverted(Number(listing.price))}
            </p>
            <p>
              <span className="font-medium text-zinc-900">Seller:</span>{" "}
              {listing.sellerName ?? `Seller #${listing.sellerId}`}
            </p>
          </div>

          <div className="flex flex-col gap-1 sm:max-w-xs">
            <label className="text-sm font-medium text-zinc-700" htmlFor="listing-currency">
              Convert price
            </label>
            <select
              id="listing-currency"
              value={selectedCurrency}
              onChange={(event) => setSelectedCurrency(event.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              disabled={loadingRates}
            >
              {availableCurrencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
            {ratesError && <p className="text-xs text-red-500">{ratesError}</p>}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => setIsBuyModalOpen(true)}>Buy Now</Button>
            {orderSuccessId && (
              <Button variant="secondary" onClick={() => router.push(`/orders/${orderSuccessId}`)}>
                View order
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-zinc-900">Reviews</h2>

        {reviews.length === 0 ? (
          <p className="text-sm text-zinc-500">No reviews yet.</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <article key={review.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <img
                    src={`https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(review.reviewerName ?? `user-${review.reviewerId}`)}`}
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
                <p className="text-sm font-medium text-zinc-900">Rating: {review.rating}/5</p>
                <p className="mt-1 text-sm text-zinc-600">{review.comment || "No comment."}</p>
              </article>
            ))}
          </div>
        )}

        {canReview && (
          <Button variant="secondary" onClick={() => setIsReviewModalOpen(true)}>
            Write a review
          </Button>
        )}
      </section>

      <Modal
        isOpen={isBuyModalOpen}
        onClose={() => setIsBuyModalOpen(false)}
        title="Confirm order"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            Confirm purchase of <span className="font-medium text-zinc-900">{listing.title}</span> for
            <span className="font-medium text-zinc-900"> ${Number(listing.price).toFixed(2)}</span>.
          </p>

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsBuyModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBuyNow} loading={buying}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        title="Submit review"
      >
        <form onSubmit={handleSubmitReview} className="space-y-4">
          {reviewError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {reviewError}
            </p>
          )}

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
            <Button variant="secondary" onClick={() => setIsReviewModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={reviewSubmitting}>
              Submit review
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
