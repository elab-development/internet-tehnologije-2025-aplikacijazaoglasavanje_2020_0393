"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import CategoryBreadcrumb from "@/components/categories/CategoryBreadcrumb";
import CurrencySelect from "@/components/CurrencySelect";
import ListingGallery from "@/components/listings/ListingGallery";
import SimilarListings from "@/components/listings/SimilarListings";
import SellerCard from "@/components/reviews/SellerCard";
import {
  Button,
  ErrorAlert,
  ListingDetailSkeleton,
  Modal,
  StatusBadge,
} from "@/components/ui";
import { useAnnounce } from "@/components/ui/Announcer";
import { useAuth } from "@/context/AuthContext";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
import { useFetch } from "@/hooks/useFetch";
import { ApiError, api } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import type {
  Category,
  CreatedOrder,
  ListingDetail,
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
    refetch: refetchListing,
  } = useFetch<ListingDetail>(hasValidId ? `/api/listings/${listingId}` : null);

  const { data: categoryData } = useFetch<Category[]>("/api/categories");

  // Errors raised by an action on this page, as opposed to the initial load.
  // Kept separate so a failed purchase no longer replaces the whole listing.
  const [actionError, setActionError] = useState<string | null>(null);

  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [orderSuccessId, setOrderSuccessId] = useState<number | null>(null);

  // Set when the server tells us the world changed underneath this page. The Buy
  // button cannot succeed again until the listing is refetched, so say so.
  const [isStale, setIsStale] = useState(false);
  const announce = useAnnounce();

  const conversion = useCurrencyConversion();
  const { formatConverted } = conversion;

  // A `reserved` or `sold` listing is publicly readable, because the buyer's own order
  // page links to it. Offering a stranger a Buy button on one only produces a 409.
  const isForSale = listing?.status === "active";

  async function handleBuyNow() {
    if (!hasValidId || !listing) return;

    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    if (user?.id === listing.sellerId) {
      setActionError("You cannot buy your own listing");
      setIsBuyModalOpen(false);
      return;
    }

    setBuying(true);
    setActionError(null);

    try {
      const order = await api.post<CreatedOrder>("/api/orders", { listingId });

      setOrderSuccessId(order.id);
      setIsBuyModalOpen(false);
      setIsStale(false);
      toast.success(`Order #${order.id} placed successfully!`);
      announce(`Order ${order.id} placed successfully`);

      // The status this page is rendering was fetched before the mutation. Without
      // this the success banner sits above a still-live Buy Now button.
      refetchListing();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create order";
      setActionError(msg);
      toast.error(msg);
      announce(msg, { assertive: true });

      // 409 means the world changed, not that the request was malformed. Retrying the
      // same click can only produce the same answer; only a reload can help.
      if (err instanceof ApiError && err.status === 409) {
        setIsStale(true);
        setIsBuyModalOpen(false);
      }
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
          <ListingGallery images={listing.images} title={listing.title} />
          <CategoryBreadcrumb
            categories={categoryData ?? []}
            categoryId={listing.categoryId}
            fallbackName={listing.categoryName}
          />
          <h1 className="text-2xl font-bold text-zinc-900">{listing.title}</h1>
          <p className="text-zinc-600">{listing.description}</p>

          <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
            <p>
              <span className="font-medium text-zinc-900">Price:</span>{" "}
              {formatPrice(listing.price)}
            </p>
            <p>
              <span className="font-medium text-zinc-900">Converted:</span>{" "}
              {formatConverted(Number(listing.price))}
            </p>
          </div>

          <CurrencySelect conversion={conversion} className="sm:max-w-xs" />

          <div className="flex flex-wrap items-center gap-2 pt-2">
            {isForSale && !isStale ? (
              <Button onClick={() => setIsBuyModalOpen(true)}>Buy Now</Button>
            ) : (
              <StatusBadge status={listing.status} kind="listing" size="md" />
            )}
            {isStale && (
              <Button
                variant="secondary"
                onClick={() => {
                  setIsStale(false);
                  setActionError(null);
                  refetchListing();
                }}
              >
                Refresh listing
              </Button>
            )}
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

      <SellerCard
        sellerId={listing.sellerId}
        name={listing.sellerName}
        avatarUrl={listing.sellerAvatarUrl}
        reviewCount={listing.sellerReviewCount}
        ratingSum={listing.sellerRatingSum}
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
              {formatPrice(listing.price)}
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
