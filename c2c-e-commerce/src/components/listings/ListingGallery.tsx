"use client";

import { useState } from "react";

import type { ListingImageSummary } from "@/types/api";

export type ListingGalleryProps = {
  images: ListingImageSummary[];
  /** Used as the large image's alt text. */
  title: string;
};

/**
 * The listing detail page's photo gallery.
 *
 * Extracted from the page itself so it can be unit-tested without dragging in auth,
 * currency conversion, the buy flow and every other thing the page depends on.
 *
 * Renders the selected image large, plus a thumbnail row when there is more than one —
 * clicking a thumbnail swaps the large image. Falls back to the first (cover) image
 * whenever nothing is selected yet or the previous selection no longer exists (e.g. it was
 * deleted). A listing with no images gets the placeholder instead.
 */
export default function ListingGallery({ images, title }: ListingGalleryProps) {
  const [activeImageId, setActiveImageId] = useState<number | null>(null);

  const displayImageId = images.some((image) => image.id === activeImageId)
    ? activeImageId
    : (images[0]?.id ?? null);

  if (!displayImageId) {
    return (
      // This is the only indication the listing has no photo — not decorative, so it
      // gets a real accessible name instead of aria-hidden. Drawn rather than set as
      // an emoji: the glyph rendered in whatever style the platform font chose, which
      // was the one icon in the interface that was not on the 24 grid.
      <div
        className="flex h-48 max-h-80 w-full select-none items-center justify-center border border-rule bg-inset text-ink-3"
        role="img"
        aria-label="No photo available"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12 opacity-60"
          aria-hidden="true"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4.5" width="18" height="15" />
          <path d="m3 16 4.2-4.2a1.6 1.6 0 0 1 2.3 0L14 16" />
          <path d="m13.5 14 1.7-1.7a1.6 1.6 0 0 1 2.3 0L21 15.5" />
          <circle cx="8.4" cy="9" r="1.2" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/images/${displayImageId}`}
        alt={title}
        className="w-full rounded-none object-cover max-h-80 border border-rule bg-inset"
      />
      {images.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setActiveImageId(image.id)}
              // The map index, not `sortOrder`: deleting an image does not renumber the
              // survivors' sortOrder, so labelling from it would drift out of sequence
              // (delete the first of three and the remaining two would announce "2" and "3").
              aria-label={`Show photo ${index + 1}`}
              aria-current={image.id === displayImageId}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-none border-2 ${
                image.id === displayImageId ? "border-ink" : "border-rule"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/images/${image.id}`}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
