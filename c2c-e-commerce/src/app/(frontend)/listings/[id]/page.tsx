"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import CategoryBreadcrumb from "@/components/categories/CategoryBreadcrumb";
import {
  makeHueResolver,
  TOP_SPINE_CLASS,
} from "@/components/categories/categoryHue";
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

  // Which of the five hues this listing's category rolls up to — the same colour it
  // carries on its card in the grid.
  const hue = useMemo(
    () => makeHueResolver(categoryData ?? [])(listing?.categoryId ?? null),
    [categoryData, listing?.categoryId],
  );

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
        <div className="flex items-start gap-3 border border-l-[6px] border-go-rule border-l-go bg-go-tint px-4 py-3 text-sm text-go-ink">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="mt-0.5 h-[18px] w-[18px] shrink-0"
            aria-hidden="true"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
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

      {/* Two columns rather than one stacked block: the price used to sit in a
          14px line between the description and the currency picker, which made the
          one number a buyer is actually here for smaller than the prose above it. */}
      <section className="grid gap-8 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div className="flex flex-col gap-5">
          <ListingGallery images={listing.images} title={listing.title} />
          <CategoryBreadcrumb
            categories={categoryData ?? []}
            categoryId={listing.categoryId}
            fallbackName={listing.categoryName}
          />
          <h1 className="text-4xl sm:text-5xl">{listing.title}</h1>
          <p className="max-w-[68ch] text-base text-ink-2">{listing.description}</p>
        </div>

        <aside
          className={[
            "flex flex-col gap-5 border-[1.5px] border-t-[6px] border-ink bg-surface p-6",
            "lg:sticky lg:top-28",
            TOP_SPINE_CLASS[hue],
          ].join(" ")}
        >
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-ink-3">Asking price</span>
            <span className="figure text-5xl leading-none">
              {formatPrice(listing.price)}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <CurrencySelect conversion={conversion} />
            <p className="text-sm text-ink-3">
              ≈ {formatConverted(Number(listing.price))} at today&rsquo;s rate
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {isForSale && !isStale ? (
              <Button fullWidth onClick={() => setIsBuyModalOpen(true)}>
                Buy Now
              </Button>
            ) : (
              <StatusBadge status={listing.status} kind="listing" size="md" />
            )}
            {isStale && (
              <Button
                variant="secondary"
                fullWidth
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
                fullWidth
                onClick={() => router.push(`/orders/${orderSuccessId}`)}
              >
                View order
              </Button>
            )}
          </div>
        </aside>
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
          <p className="text-sm text-ink-2">
            Confirm purchase of{" "}
            <span className="font-medium text-ink">{listing.title}</span>{" "}
            for
            <span className="font-medium text-ink">
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
