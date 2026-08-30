"use client";

import Link from "next/link";

import { useFetch } from "@/hooks/useFetch";
import type { SimilarListing } from "@/types/api";

export type SimilarListingsProps = {
  listingId: number;
};

/**
 * C2C-AI-9 — the "Similar listings" section.
 *
 * Renders nothing at all unless there is something to show. Loading, error, an empty
 * array and a malformed body all produce `null`: this strip is supplementary, and a
 * spinner or an error banner for it would compete with the page's actual content — which
 * has loaded fine in every one of those cases.
 */
export default function SimilarListings({
  listingId,
}: SimilarListingsProps): React.ReactElement | null {
  const { data } = useFetch<SimilarListing[]>(
    Number.isInteger(listingId) && listingId > 0
      ? `/api/listings/${listingId}/similar?limit=6`
      : null,
  );

  // The array check also covers an error body, which arrives as `{ error: … }`.
  if (!Array.isArray(data) || data.length === 0) return null;

  return (
    <section className="mt-12" aria-labelledby="similar-listings-heading">
      <h2
        id="similar-listings-heading"
        className="mb-4 text-xl font-semibold text-gray-900"
      >
        Similar listings
      </h2>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {data.map((listing) => (
          <li key={listing.id}>
            <Link
              href={`/listings/${listing.id}`}
              className="block overflow-hidden rounded-lg border border-gray-200 transition hover:border-gray-400 hover:shadow-sm"
            >
              {listing.coverImageId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/images/${listing.coverImageId}`}
                  alt=""
                  className="h-24 w-full object-cover"
                />
              ) : (
                <div className="h-24 w-full bg-gray-100" />
              )}

              <div className="p-2">
                <p className="line-clamp-2 text-sm font-medium text-gray-900">
                  {listing.title}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  {Number(listing.price).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
