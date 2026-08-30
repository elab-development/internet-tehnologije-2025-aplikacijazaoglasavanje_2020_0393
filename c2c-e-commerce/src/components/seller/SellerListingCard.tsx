"use client";

import {
  RiDeleteBin2Line,
  RiEyeLine,
  RiEyeOffLine,
} from "@remixicon/react";
import { Button, Card, StatusBadge } from "@/components/ui";
import type { Listing } from "@/types/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SellerListingCardProps = {
  listing: Listing;
  formatConverted: (amount: number) => string;
  /** Whether the status toggle is mid-request for this listing. */
  updating?: boolean;
  /** Show the destructive delete control (admins only). */
  canDelete?: boolean;
  onOpen: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
};

const DESCRIPTION_LIMIT = 80;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * One card in the seller's "My Listings" grid: price, status, and the
 * activate/disable and delete controls.
 */
export default function SellerListingCard({
  listing,
  formatConverted,
  updating = false,
  canDelete = false,
  onOpen,
  onToggleStatus,
  onDelete,
}: SellerListingCardProps) {
  const isActive = listing.status === "active";
  // A sold listing cannot be put back on sale from here.
  const canToggle = isActive || listing.status === "removed";

  const description =
    listing.description.length > DESCRIPTION_LIMIT
      ? listing.description.slice(0, DESCRIPTION_LIMIT) + "…"
      : listing.description;

  return (
    <Card
      image={listing.coverImageId ? `/api/images/${listing.coverImageId}` : null}
      title={listing.title}
      badge={listing.status}
      description={description}
      onClick={onOpen}
      // The seller dashboard shows removed (and, once drafts are visible here, draft)
      // listings, whose images 404 through next/image's cookie-less optimizer fetch —
      // see Card's `unoptimized` doc. The bytes are already sharp-produced WebP capped
      // at 4000px and served same-origin, so the optimizer has little left to add here.
      unoptimized
      footer={
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-900">
                ${Number(listing.price).toFixed(2)}
              </span>
              <span className="text-zinc-500">
                ({formatConverted(Number(listing.price))})
              </span>
            </div>
            <StatusBadge status={listing.status} kind="listing" />
          </div>

          <div className="flex items-center gap-2">
            {canToggle && (
              <Button
                variant={isActive ? "danger" : "primary"}
                size="sm"
                fullWidth
                icon={
                  isActive ? <RiEyeOffLine size={16} /> : <RiEyeLine size={16} />
                }
                loading={updating}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleStatus();
                }}
              >
                {isActive ? "Disable" : "Activate"}
              </Button>
            )}

            {canDelete && (
              <button
                type="button"
                aria-label="Delete listing"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100 hover:border-red-300"
              >
                <RiDeleteBin2Line size={15} />
              </button>
            )}
          </div>
        </div>
      }
    />
  );
}
