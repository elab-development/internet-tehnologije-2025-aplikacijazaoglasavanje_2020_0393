"use client";

import Link from "next/link";

import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import type { RecommendationsResponse } from "@/types/api";

/**
 * C2C-AI-10 — the "Recommended for you" home-page section.
 *
 * Absent entirely for anonymous visitors, and absent when there is nothing to show.
 *
 * The heading follows `strategy`. A cold-start list is genuinely just what is popular, and
 * calling it "recommended for you" would be a small lie the UI tells on every first visit —
 * which is precisely why the story puts `strategy` in the response rather than leaving the
 * two paths indistinguishable.
 */
export default function RecommendedForYou(): React.ReactElement | null {
  const { isAuthenticated } = useAuth();

  const { data } = useFetch<RecommendationsResponse>(
    isAuthenticated ? "/api/recommendations?limit=6" : null,
  );

  if (!isAuthenticated) return null;
  if (!data || !Array.isArray(data.data) || data.data.length === 0) return null;

  const personalised = data.strategy === "personalised";

  return (
    <section className="w-full" aria-labelledby="recommendations-heading">
      <h2
        id="recommendations-heading"
        className="mb-4 text-xl font-semibold text-zinc-900"
      >
        {personalised ? "Recommended for you" : "Popular right now"}
      </h2>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {data.data.map((listing) => (
          <li key={listing.id}>
            <Link
              href={`/listings/${listing.id}`}
              className="block overflow-hidden rounded-lg border border-zinc-200 text-left transition hover:border-zinc-400 hover:shadow-sm"
            >
              {listing.coverImageId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/images/${listing.coverImageId}`}
                  alt=""
                  className="h-24 w-full object-cover"
                />
              ) : (
                <div className="h-24 w-full bg-zinc-100" />
              )}

              <div className="p-2">
                <p className="line-clamp-2 text-sm font-medium text-zinc-900">
                  {listing.title}
                </p>
                <p className="mt-1 text-sm text-zinc-600">
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
