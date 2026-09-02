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
      // This emoji is the only indication the listing has no photo — not decorative, so
      // it gets a real accessible name (as StarRating.tsx does for its glyphs) instead of
      // aria-hidden, and a shade that clears 4.5:1.
      <div
        className="flex w-full items-center justify-center rounded-xl border border-zinc-100 bg-zinc-50 max-h-80 h-48 text-zinc-500 text-5xl select-none"
        role="img"
        aria-label="No photo available"
      >
        🖼️
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/images/${displayImageId}`}
        alt={title}
        className="w-full rounded-xl object-cover max-h-80 border border-zinc-100 bg-zinc-50"
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
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                image.id === displayImageId ? "border-indigo-500" : "border-zinc-100"
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
