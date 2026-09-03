"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import SellerReviewFeed from "@/components/reviews/SellerReviewFeed";
import StarRating from "@/components/reviews/StarRating";
import { ErrorAlert, Skeleton } from "@/components/ui";
import { useFetch } from "@/hooks/useFetch";
import { avatarUrl, formatPrice } from "@/lib/format";
import type { ListingsResponse, SellerReviewsResponse } from "@/types/api";

/**
 * A seller's public profile (spec §6.4).
 *
 * Two requests rather than one endpoint that returns both: the listings come from
 * `GET /api/listings?sellerId=`, which already knows that a stranger sees only `active`
 * rows. Duplicating that visibility rule in a new endpoint is how the two would drift.
 */
/** Also the `limit` the first page is fetched with -- the feed continues from it. */
const REVIEWS_PER_PAGE = 20;

export default function SellerProfilePage() {
  const params = useParams<{ id: string }>();
  const sellerId = Number(params.id);
  const hasValidId = Number.isInteger(sellerId) && sellerId > 0;

  const { data, loading, error } = useFetch<SellerReviewsResponse>(
    hasValidId ? `/api/users/${sellerId}/reviews?limit=${REVIEWS_PER_PAGE}` : null,
  );

  const { data: listingData } = useFetch<ListingsResponse>(
    hasValidId ? `/api/listings?sellerId=${sellerId}&limit=12` : null,
  );

  if (!hasValidId || (!loading && (error || !data))) {
    return <ErrorAlert message={!hasValidId ? "Invalid user id" : (error ?? "Seller not found")} />;
  }

  if (loading || !data) {
    return (
      <div className="space-y-6" aria-hidden="true">
        <Skeleton className="h-16 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { seller } = data;
  const listings = listingData?.data ?? [];

  return (
    <div className="space-y-8">
      <section className="flex items-center gap-4 rounded-none border border-rule bg-white p-6 shadow-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={seller.avatarUrl ?? avatarUrl(sellerId)}
          alt=""
          className="h-16 w-16 rounded-none border border-rule bg-inset"
        />
        <div>
          <h1 className="text-2xl font-bold text-ink">{seller.name}</h1>
          <StarRating value={seller.averageRating} count={seller.reviewCount} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">
          Reviews {seller.reviewCount > 0 && `(${seller.reviewCount})`}
        </h2>
        <SellerReviewFeed
          sellerId={sellerId}
          initialReviews={data.data}
          total={seller.reviewCount}
          pageSize={REVIEWS_PER_PAGE}
        />
      </section>

      {listings.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-ink">Also selling</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {listings.map((listing) => (
              <li key={listing.id}>
                <Link
                  href={`/listings/${listing.id}`}
                  className="block overflow-hidden rounded-none border border-rule transition hover:border-ink-3 hover:shadow-none"
                >
                  {listing.coverImageId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/images/${listing.coverImageId}`}
                      alt=""
                      className="h-24 w-full object-cover"
                    />
                  ) : (
                    <div className="h-24 w-full bg-inset" />
                  )}
                  <div className="p-2">
                    <p className="line-clamp-2 text-sm font-medium text-ink">
                      {listing.title}
                    </p>
                    <p className="mt-1 text-sm text-ink-2">
                      {formatPrice(listing.price)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
