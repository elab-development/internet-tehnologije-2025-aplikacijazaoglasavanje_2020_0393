"use client";

import Link from "next/link";

import StarRating from "./StarRating";
import { avatarUrl as buildAvatarUrl } from "@/lib/format";
import { ratingAverage } from "@/lib/reviews";

export type SellerCardProps = {
  sellerId: number;
  name: string | null;
  avatarUrl: string | null;
  reviewCount: number;
  ratingSum: number;
};

/**
 * The seller block on a listing page (spec §6.4).
 *
 * What used to be a review list is now a link to one. A one-off listing's reviews were
 * always going to be thin; the seller's are the thing worth reading, and they live on
 * their own page.
 *
 * The average is derived here with the same function the API uses, rather than sent as a
 * third field — two integers and one shared rule beats a number computed in two places.
 */
export default function SellerCard({
  sellerId,
  name,
  avatarUrl,
  reviewCount,
  ratingSum,
}: SellerCardProps) {
  const displayName = name ?? `Seller #${sellerId}`;

  return (
    <section
      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
      aria-labelledby="seller-card-heading"
    >
      <h2 id="seller-card-heading" className="mb-3 text-sm font-semibold text-zinc-500">
        Sold by
      </h2>

      <Link href={`/users/${sellerId}`} className="flex items-center gap-3 group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl ?? buildAvatarUrl(sellerId)}
          alt=""
          className="h-10 w-10 rounded-full border border-zinc-200 bg-zinc-50"
        />
        <div>
          <p className="font-medium text-zinc-900 group-hover:underline">{displayName}</p>
          <StarRating
            value={ratingAverage({ reviewCount, ratingSum })}
            count={reviewCount}
            size="sm"
          />
        </div>
      </Link>
    </section>
  );
}
