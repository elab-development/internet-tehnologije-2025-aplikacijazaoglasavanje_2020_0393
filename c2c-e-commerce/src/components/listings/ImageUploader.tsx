"use client";

import { useEffect, useMemo, useState } from "react";

import type { ListingImageSummary } from "@/types/api";

/** Mirrors MAX_IMAGES_PER_LISTING in src/db/listing-images.ts. */
const MAX_IMAGES = 8;

/** Matches the server's limit. The UI promises this in the help text below the input. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Matches the `accept` attribute, which a file picker can override. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

function rejectionFor(file: File): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name} is not a JPEG, PNG or WebP.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name} is larger than 5 MB.`;
  }
  return null;
}

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
  const [problems, setProblems] = useState<string[]>([]);

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

    // Validate before accepting anything. Previously the only check was the server's,
    // which arrives after the seller has finished the form and waited through the
    // upload — and then leaves a draft behind.
    const accepted: File[] = [];
    const rejected: string[] = [];

    for (const file of picked) {
      const problem = rejectionFor(file);
      if (problem) rejected.push(problem);
      else accepted.push(file);
    }

    if (total + accepted.length > MAX_IMAGES) {
      setProblems([`You can attach at most ${MAX_IMAGES} photos to a listing.`]);
      return;
    }

    setProblems(rejected);
    if (accepted.length > 0) onFilesChange([...files, ...accepted]);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-ink-2" htmlFor="listing-photos">
        Photos
      </label>

      <input
        id="listing-photos"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        onChange={handleSelect}
        className="text-sm text-ink-2 file:mr-3 file:rounded-none file:border-0 file:bg-inset file:px-3 file:py-2 file:text-sm file:font-medium file:text-black"
      />

      <p className="text-xs text-ink-3">
        JPEG, PNG or WebP. Up to {MAX_IMAGES} photos, 5 MB each. The first is the cover.
      </p>

      {problems.length > 0 && (
        <ul className="text-xs text-stop">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {total > 0 && (
        <ul className="flex flex-wrap gap-2">
          {existing.map((image, index) => (
            <li key={`existing-${image.id}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/images/${image.id}`}
                // L27: `Listing photo ${image.id}` told a blind user "Listing photo
                // 4162" — a database id conveys nothing. Position among the set does.
                alt={`Listing photo ${index + 1} of ${existing.length}`}
                className="h-20 w-20 rounded-none border border-rule object-cover"
              />
              <button
                type="button"
                aria-label={`Remove image ${image.id}`}
                onClick={() => onRemoveExisting(image.id)}
                disabled={disabled}
                className="absolute -right-1 -top-1 rounded-none bg-ink/80 px-1.5 text-xs text-white"
              >
                ×
              </button>
            </li>
          ))}

          {previews.map(({ file, url }) => (
            <li key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={file.name}
                className="h-20 w-20 rounded-none border border-rule object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onFilesChange(files.filter((f) => f !== file))}
                disabled={disabled}
                className="absolute -right-1 -top-1 rounded-none bg-ink/80 px-1.5 text-xs text-white"
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
