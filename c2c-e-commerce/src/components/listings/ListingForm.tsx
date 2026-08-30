"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Button, ErrorAlert, InputField } from "@/components/ui";
import CategorySelect from "@/components/categories/CategorySelect";
import DescriptionAssistant from "./DescriptionAssistant";
import ImageUploader from "./ImageUploader";
import { useFetch } from "@/hooks/useFetch";
import { api } from "@/lib/api";
import type {
  Category,
  CreatedListing,
  ListingDetail,
  ListingImageSummary,
  ListingStatus,
} from "@/types/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ListingFormProps =
  | { mode: "create"; listingId?: never }
  | { mode: "edit"; listingId: number };

const listingStatuses: ListingStatus[] = ["active", "sold", "removed"];

const selectClasses =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20";

// ─── Loading placeholder ──────────────────────────────────────────────────────

function ListingFormSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4" aria-hidden="true">
      <div className="h-8 w-40 skeleton-shimmer rounded-lg" />
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-4 w-20 skeleton-shimmer rounded" />
            <div className="h-10 w-full skeleton-shimmer rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * The create/edit listing form, shared by `/listings/new` and
 * `/listings/[id]/edit`. In edit mode it loads the listing and exposes the
 * status field; in create mode it starts empty.
 *
 * Callers are responsible for the auth and role gate — wrap it in
 * `<ProtectedRoute allowedRoles={["seller", "admin"]}>`.
 */
export default function ListingForm(props: ListingFormProps) {
  const { mode } = props;
  const isEdit = mode === "edit";
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<ListingImageSummary[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [status, setStatus] = useState<ListingStatus>("active");

  // Set once a draft comes back from the model, so the seller can see that the text they
  // are about to publish under their own name started as a generation.
  const [aiAssisted, setAiAssisted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: categoryData } = useFetch<Category[]>("/api/categories");
  const categories = categoryData ?? [];

  const {
    data: listing,
    loading: listingLoading,
    error: loadError,
  } = useFetch<ListingDetail>(
    isEdit ? `/api/listings/${props.listingId}` : null,
  );

  // Prefill once the listing being edited arrives.
  useEffect(() => {
    if (!listing) return;
    setTitle(listing.title);
    setDescription(listing.description);
    setPrice(String(Number(listing.price)));
    setExistingImages(listing.images ?? []);
    setCategoryId(listing.categoryId ?? null);
    setStatus(listing.status);
  }, [listing]);

  async function handleRemoveExisting(imageId: number) {
    if (props.mode !== "edit") return;
    try {
      await api.delete(`/api/listings/${props.listingId}/images/${imageId}`);
      setExistingImages((current) => current.filter((image) => image.id !== imageId));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not remove that photo");
    }
  }

  /**
   * Uploads each chosen file against a listing that already exists.
   *
   * Sequential rather than parallel: the server appends by reading the current highest
   * sortOrder, so concurrent uploads would race for the same position.
   */
  async function uploadFiles(listingId: number): Promise<void> {
    for (const file of files) {
      const body = new FormData();
      body.set("file", file);

      const response = await fetch(`/api/listings/${listingId}/images`, {
        method: "POST",
        credentials: "include",
        body,
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error ?? `Could not upload ${file.name}`);
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (!title.trim() || !description.trim() || !price.trim()) {
      setSubmitError("Title, description, and price are required");
      return;
    }

    const payload = {
      title: title.trim(),
      description: description.trim(),
      price: Number(price),
      categoryId,
    };

    setSubmitting(true);

    try {
      if (props.mode === "edit") {
        await api.put(`/api/listings/${props.listingId}`, {
          ...payload,
          status,
        });
        if (files.length > 0) await uploadFiles(props.listingId);
        toast.success("Listing updated successfully!");
        router.push(`/listings/${props.listingId}`);
      } else {
        // Create as a draft, upload against its id, then publish. A failure part-way
        // leaves a draft the seller can finish or delete from their dashboard — no
        // staging area, and no orphaned uploads.
        const created = await api.post<CreatedListing>("/api/listings", {
          ...payload,
          status: "draft",
        });

        await uploadFiles(created.id);

        await api.put(`/api/listings/${created.id}`, { status: "active" });

        toast.success("Listing created successfully!");
        router.push(`/listings/${created.id}`);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : isEdit
            ? "Failed to update listing"
            : "Failed to create listing";
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (isEdit && listingLoading) return <ListingFormSkeleton />;

  const error = submitError ?? loadError;

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold text-zinc-900">
        {isEdit ? "Edit listing" : "Create listing"}
      </h1>

      {error && <ErrorAlert message={error} className="mb-4" />}

      <form onSubmit={handleSubmit} className="space-y-4">
        <InputField
          label="Title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Product title"
          required
        />

        {/* A textarea, not an InputField: that renders a single-line input, and a 60-120
            word generated description is unusable in one. */}
        <div className="space-y-1.5">
          <label
            htmlFor="listing-description"
            className="block text-sm font-medium text-zinc-700"
          >
            Description
          </label>
          <textarea
            id="listing-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Product description"
            rows={6}
            required
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />

          {aiAssisted && (
            <p className="text-xs text-zinc-500">
              Drafted with AI — review it before publishing. It is your listing.
            </p>
          )}

          <DescriptionAssistant
            title={title}
            hasDescription={description.trim().length > 0}
            onGenerated={(text) => {
              setDescription(text);
              setAiAssisted(true);
            }}
          />
        </div>

        <InputField
          label="Price"
          type="number"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          min={0}
          step={0.01}
          placeholder="0.00"
          required
        />

        <ImageUploader
          files={files}
          existing={existingImages}
          onFilesChange={setFiles}
          onRemoveExisting={handleRemoveExisting}
          disabled={submitting}
        />

        <CategorySelect
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
        />

        {isEdit && (
          <div className="flex flex-col gap-1">
            <label
              className="text-sm font-medium text-zinc-700"
              htmlFor="listing-status"
            >
              Status
            </label>
            <select
              id="listing-status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as ListingStatus)
              }
              className={selectClasses}
            >
              {listingStatuses.map((listingStatus) => (
                <option key={listingStatus} value={listingStatus}>
                  {listingStatus.charAt(0).toUpperCase() +
                    listingStatus.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          {props.mode === "edit" && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/listings/${props.listingId}`)}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" loading={submitting}>
            {isEdit ? "Save changes" : "Create listing"}
          </Button>
        </div>
      </form>
    </div>
  );
}
