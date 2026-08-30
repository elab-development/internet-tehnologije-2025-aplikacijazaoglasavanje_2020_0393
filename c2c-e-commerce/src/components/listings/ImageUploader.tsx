"use client";

import { useEffect, useMemo, useState } from "react";

import type { ListingImageSummary } from "@/types/api";

/** Mirrors MAX_IMAGES_PER_LISTING in src/db/listing-images.ts. */
const MAX_IMAGES = 8;

export type ImageUploaderProps = {
  /** Files chosen but not yet uploaded. The form owns this list. */
  files: File[];
  /** Images already stored against the listing (edit mode). */
  existing: ListingImageSummary[];
  onFilesChange: (files: File[]) => void;
  onRemoveExisting: (imageId: number) => void;
  disabled?: boolean;
};

/**
 * Photo picker with local previews.
 *
 * Nothing is uploaded here — the form submits, creates the listing, then uploads against
 * its id. Previews are object URLs, so a half-filled form costs nothing on the server and
 * there is no orphaned upload to collect.
 */
export default function ImageUploader({
  files,
  existing,
  onFilesChange,
  onRemoveExisting,
  disabled = false,
}: ImageUploaderProps) {
  const [tooMany, setTooMany] = useState(false);

  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );

  // Object URLs are a document-lifetime leak until revoked.
  useEffect(() => {
    return () => previews.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [previews]);

  const total = files.length + existing.length;

  function handleSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;

    if (total + picked.length > MAX_IMAGES) {
      setTooMany(true);
      return;
    }

    setTooMany(false);
    onFilesChange([...files, ...picked]);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-zinc-700" htmlFor="listing-photos">
        Photos
      </label>

      <input
        id="listing-photos"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        onChange={handleSelect}
        className="text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700"
      />

      <p className="text-xs text-zinc-500">
        JPEG, PNG or WebP. Up to {MAX_IMAGES} photos, 5 MB each. The first is the cover.
      </p>

      {tooMany && (
        <p className="text-xs text-red-600">You can attach at most 8 photos to a listing.</p>
      )}

      {total > 0 && (
        <ul className="flex flex-wrap gap-2">
          {existing.map((image) => (
            <li key={`existing-${image.id}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/images/${image.id}`}
                alt={`Listing photo ${image.id}`}
                className="h-20 w-20 rounded-lg border border-zinc-200 object-cover"
              />
              <button
                type="button"
                aria-label={`Remove image ${image.id}`}
                onClick={() => onRemoveExisting(image.id)}
                disabled={disabled}
                className="absolute -right-1 -top-1 rounded-full bg-zinc-900/80 px-1.5 text-xs text-white"
              >
                ×
              </button>
            </li>
          ))}

          {previews.map(({ file, url }) => (
            <li key={`pending-${file.name}-${file.size}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={file.name}
                className="h-20 w-20 rounded-lg border border-zinc-200 object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onFilesChange(files.filter((f) => f !== file))}
                disabled={disabled}
                className="absolute -right-1 -top-1 rounded-full bg-zinc-900/80 px-1.5 text-xs text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
