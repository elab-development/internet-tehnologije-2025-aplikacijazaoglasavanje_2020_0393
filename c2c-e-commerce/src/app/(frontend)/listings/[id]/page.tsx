"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import CurrencySelect from "@/components/CurrencySelect";
import ListingReviews from "@/components/listings/ListingReviews";
import SimilarListings from "@/components/listings/SimilarListings";
import {
  Button,
  ErrorAlert,
  ListingDetailSkeleton,
  Modal,
} from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
import { useFetch } from "@/hooks/useFetch";
import { api } from "@/lib/api";
import type {
  Category,
  CreatedOrder,
  ListingDetail,
  Review,
} from "@/types/api";

export default function ListingDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isAuthenticated } = useAuth();

  const listingId = Number(params.id);
  const hasValidId = Number.isInteger(listingId) && listingId > 0;

  const {
    data: listing,
    loading,
    error: loadError,
  } = useFetch<ListingDetail>(hasValidId ? `/api/listings/${listingId}` : null);

  const { data: categoryData } = useFetch<Category[]>("/api/categories");
  const { data: reviewData, refetch: refetchReviews } = useFetch<Review[]>(
    hasValidId ? `/api/listings/${listingId}/reviews` : null,
  );

  // Errors raised by an action on this page, as opposed to the initial load.
  // Kept separate so a failed purchase no longer replaces the whole listing.
  const [actionError, setActionError] = useState<string | null>(null);

  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [orderSuccessId, setOrderSuccessId] = useState<number | null>(null);

  const conversion = useCurrencyConversion();
  const { formatConverted } = conversion;

  const canReview = isAuthenticated && user?.role === "buyer";

  const categoryName = useMemo(() => {
    if (listing?.categoryName) return listing.categoryName;
    if (!listing?.categoryId) return "Uncategorized";
    const category = (categoryData ?? []).find(
      (item) => item.id === listing.categoryId,
    );
    return category?.name ?? "Uncategorized";
  }, [categoryData, listing]);

  async function handleBuyNow() {
    if (!hasValidId) return;

    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    if (user?.role !== "buyer") {
      setActionError("Only buyers can place orders");
      setIsBuyModalOpen(false);
      return;
    }

    setBuying(true);
    setActionError(null);

    try {
      const order = await api.post<CreatedOrder>("/api/orders", {
        items: [{ listingId }],
      });

      setOrderSuccessId(order.id);
      setIsBuyModalOpen(false);
      toast.success(`Order #${order.id} placed successfully!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create order";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBuying(false);
    }
  }

  if (hasValidId && loading) return <ListingDetailSkeleton />;

  if (!hasValidId || !listing) {
    return (
      <div className="space-y-4">
        <ErrorAlert
          message={
            !hasValidId
              ? "Invalid listing id"
              : (loadError ?? "Listing not found")
          }
        />
        <Button variant="secondary" onClick={() => router.push("/listings")}>
          Back to listings
        </Button>
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
            <p>
              Order ID:{" "}
              <span className="font-mono font-bold">#{orderSuccessId}</span>
            </p>
          </div>
        </div>
      )}

      {actionError && <ErrorAlert message={actionError} />}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4">
          {listing.imageUrl ? (
            <img
              src={listing.imageUrl}
              alt={listing.title}
              className="w-full rounded-xl object-cover max-h-80 border border-zinc-100 bg-zinc-50"
            />
          ) : (
            <div className="flex w-full items-center justify-center rounded-xl border border-zinc-100 bg-zinc-50 max-h-80 h-48 text-zinc-300 text-5xl select-none">
              🖼️
            </div>
          )}
          <span className="inline-flex w-fit rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
            {categoryName}
          </span>
          <h1 className="text-2xl font-bold text-zinc-900">{listing.title}</h1>
          <p className="text-zinc-600">{listing.description}</p>

          <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
            <p>
              <span className="font-medium text-zinc-900">Price:</span> $
              {Number(listing.price).toFixed(2)}
            </p>
            <p>
              <span className="font-medium text-zinc-900">Converted:</span>{" "}
              {formatConverted(Number(listing.price))}
            </p>
            <p>
              <span className="font-medium text-zinc-900">Seller:</span>{" "}
              {listing.sellerName ?? `Seller #${listing.sellerId}`}
            </p>
          </div>

          <CurrencySelect conversion={conversion} className="sm:max-w-xs" />

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => setIsBuyModalOpen(true)}>Buy Now</Button>
            {orderSuccessId && (
              <Button
                variant="secondary"
                onClick={() => router.push(`/orders/${orderSuccessId}`)}
              >
                View order
              </Button>
            )}
          </div>
        </div>
      </section>

      <ListingReviews
        listingId={listingId}
        reviews={reviewData ?? []}
        canReview={canReview}
        onReviewCreated={refetchReviews}
      />

      {/* Renders nothing when there is nothing to recommend, so no empty heading is left
          behind on a listing with no neighbours (AI-9 AC9). */}
      <SimilarListings listingId={listingId} />

      <Modal
        isOpen={isBuyModalOpen}
        onClose={() => setIsBuyModalOpen(false)}
        title="Confirm order"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            Confirm purchase of{" "}
            <span className="font-medium text-zinc-900">{listing.title}</span>{" "}
            for
            <span className="font-medium text-zinc-900">
              {" "}
              ${Number(listing.price).toFixed(2)}
            </span>
            .
          </p>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setIsBuyModalOpen(false)}
            >
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
