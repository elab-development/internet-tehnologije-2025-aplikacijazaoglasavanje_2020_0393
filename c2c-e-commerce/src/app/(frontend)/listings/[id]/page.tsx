"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import InputField from "@/components/ui/InputField";
import Modal from "@/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";
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
  createdAt: string;
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

  const [comment, setComment] = useState("");
  const [rating, setRating] = useState("5");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const canReview = isAuthenticated && user?.role === "buyer";

  const categoryName = useMemo(() => {
    if (listing?.categoryName) return listing.categoryName;
    if (!listing?.categoryId) return "Uncategorized";
    const category = categories.find((item) => item.id === listing.categoryId);
    return category?.name ?? "Uncategorized";
  }, [categories, listing]);

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

        const [listingData, reviewData, categoryData] = await Promise.all([
          api.get<Listing>(`/api/listings/${idNum}`),
          api.get<Review[]>(`/api/listings/${idNum}/reviews`),
          api.get<Category[]>("/api/categories"),
        ]);

        if (!alive) return;

        setListing(listingData);
        setReviews(reviewData);
        setCategories(categoryData);
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
      await api.post("/api/orders", {
        items: [{ listingId, quantity: 1 }],
      });
      setIsBuyModalOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create order");
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
      const ratingValue = Number(rating);
      if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
        setReviewError("Rating must be between 1 and 5");
        return;
      }

      const created = await api.post<Review>(`/api/listings/${listingId}/reviews`, {
        comment: comment.trim(),
        rating: ratingValue,
      });

      setReviews((prev) => [...prev, created]);
      setComment("");
      setRating("5");
    } catch (err: unknown) {
      setReviewError(err instanceof Error ? err.message : "Failed to submit review");
    } finally {
      setReviewSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading listing...</p>;
  }

  if (error || !listing) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? "Listing not found"}
        </p>
        <Button variant="secondary" onClick={() => router.push("/")}>Back to listings</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
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
              <span className="font-medium text-zinc-900">Seller:</span>{" "}
              {listing.sellerName ?? `Seller #${listing.sellerId}`}
            </p>
          </div>

          <div className="pt-2">
            <Button onClick={() => setIsBuyModalOpen(true)}>Buy Now</Button>
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
                <p className="text-sm font-medium text-zinc-900">Rating: {review.rating}/5</p>
                <p className="mt-1 text-sm text-zinc-600">{review.comment || "No comment."}</p>
              </article>
            ))}
          </div>
        )}

        {canReview && (
          <form onSubmit={handleSubmitReview} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-zinc-900">Leave a review</h3>

            {reviewError && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {reviewError}
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <InputField
                label="Comment"
                type="text"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Share your experience"
              />

              <InputField
                label="Star rating"
                type="number"
                value={rating}
                onChange={(event) => setRating(event.target.value)}
                min={1}
                max={5}
                step={1}
              />
            </div>

            <div className="mt-4">
              <Button type="submit" loading={reviewSubmitting}>
                Submit review
              </Button>
            </div>
          </form>
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
    </div>
  );
}
