"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Button, ErrorAlert, InputField, Modal } from "@/components/ui";
import { useAnnounce } from "@/components/ui/Announcer";
import FormErrorSummary, { type FieldError } from "@/components/ui/FormErrorSummary";
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

/**
 * Parses what a person typed into a price.
 *
 * `<input type="number">` reports an empty value for anything the browser thinks is
 * malformed, and this app lists RSD — where the decimal separator people type is a
 * comma. "1500,50" arrived as "" and the form said the price was required while the
 * field visibly held a number.
 */
export function parsePriceInput(raw: string): number | null {
  const normalised = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;
  const value = Number(normalised);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

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
  // Superseded by fieldProblems (M10): the single "Title, description, and price are
  // required" banner collapsed several possible failures into one string with no
  // field-level error at all. Each problem is now its own summary entry, pointing at
  // its field.
  const [fieldProblems, setFieldProblems] = useState<FieldError[]>([]);

  /**
   * The draft created by a previous, failed submit.
   *
   * `created.id` used to be a const inside the try block, so a failure during upload
   * lost it — and the retry created a second draft, re-uploading the photos that had
   * already succeeded into it. The orphan sat in the dashboard with no available
   * action, because drafts could be neither activated nor deleted by their seller.
   */
  const [draftId, setDraftId] = useState<number | null>(null);

  // The existing photo pending a confirmed delete. Set by ImageUploader's × button;
  // the DELETE itself waits for the confirmation dialog below.
  const [photoPendingRemoval, setPhotoPendingRemoval] = useState<number | null>(null);

  // What the form looked like before the seller touched it: blank in create mode, or
  // whatever the fetched listing prefilled in edit mode (set alongside it below). isDirty
  // compares the live fields against this rather than against "" / [], so an edit-mode
  // form that has only just finished loading its own prefilled values does not read as
  // dirty before the seller has changed anything.
  const [initialValues, setInitialValues] = useState({ title: "", description: "", price: "" });

  const announce = useAnnounce();

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
    const listingPrice = String(Number(listing.price));
    setTitle(listing.title);
    setDescription(listing.description);
    setPrice(listingPrice);
    setExistingImages(listing.images ?? []);
    setCategoryId(listing.categoryId ?? null);
    setStatus(listing.status);
    setInitialValues({
      title: listing.title,
      description: listing.description,
      price: listingPrice,
    });
  }, [listing]);

  // isDirty is any of title / description / price / files differing from their initial
  // values (L22): title, description and price against the baseline set above, files
  // against the empty array every mode starts with, since a staged upload never has an
  // "initial" value to compare against.
  const isDirty =
    title !== initialValues.title ||
    description !== initialValues.description ||
    price !== initialValues.price ||
    files.length > 0;

  // A browser-navigation guard only: `beforeunload` fires on a tab close, reload or typed
  // URL, but not on an in-app route change via `router.push` — the App Router does not run
  // navigation through it. Catching those too would need a route-change interception
  // (e.g. a confirmation on `router.push`), which is out of scope here.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  async function confirmRemoveExisting() {
    const imageId = photoPendingRemoval;
    setPhotoPendingRemoval(null);
    if (imageId === null || props.mode !== "edit") return;
    try {
      await api.delete(`/api/listings/${props.listingId}/images/${imageId}`);
      setExistingImages((current) => current.filter((image) => image.id !== imageId));
      announce("Photo removed");
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

    const parsedPrice = parsePriceInput(price);

    const problems: FieldError[] = [];
    if (!title.trim()) problems.push({ field: "listing-title", message: "Title is required" });
    if (!description.trim())
      problems.push({ field: "listing-description", message: "Description is required" });
    if (!price.trim()) problems.push({ field: "listing-price", message: "Price is required" });
    if (parsedPrice === null && price.trim())
      problems.push({ field: "listing-price", message: "Enter a price like 19.99" });

    setFieldProblems(problems);
    if (problems.length > 0) return;

    const payload = {
      title: title.trim(),
      description: description.trim(),
      price: parsedPrice,
      categoryId,
    };

    setSubmitting(true);

    // Tracks the draft across this call. `draftId` state only updates on the *next*
    // render, so a catch block reading the state directly would still see `null` on the
    // very submit that just created the draft — this local mirrors the state instead.
    let currentDraftId = draftId;

    try {
      if (props.mode === "edit") {
        await api.patch(`/api/listings/${props.listingId}`, {
          ...payload,
          status,
        });
        if (files.length > 0) await uploadFiles(props.listingId);
        toast.success("Listing updated successfully!");
        router.push(`/listings/${props.listingId}`);
      } else {
        // Create as a draft, upload against its id, then publish. A failure part-way
        // leaves a draft the seller can finish or delete from their dashboard — no
        // staging area, and no orphaned uploads. `draftId` carries the id across a
        // retry, so a second submit reuses the same draft instead of creating another
        // one and re-uploading photos that already succeeded.
        const listingId =
          draftId ??
          (
            await api.post<CreatedListing>("/api/listings", {
              ...payload,
              status: "draft",
            })
          ).id;

        currentDraftId = listingId;
        setDraftId(listingId);

        await uploadFiles(listingId);

        await api.patch(`/api/listings/${listingId}`, { status: "active" });

        currentDraftId = null;
        setDraftId(null);
        toast.success("Listing created successfully!");
        router.push(`/listings/${listingId}`);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : isEdit
            ? "Failed to update listing"
            : "Failed to create listing";
      setSubmitError(
        currentDraftId
          ? `${msg} Your listing was saved as a draft — press Create listing again to finish it, or delete it from your dashboard.`
          : msg,
      );
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (isEdit && listingLoading) return <ListingFormSkeleton />;

  const error = submitError ?? loadError;
  // Looks up a field's message in the same list that feeds the summary, so Title and
  // Price get the same aria-invalid/aria-describedby wiring /login and /register's
  // fields already have — the summary is additive, not a replacement for the per-field
  // error M10 also named as missing here.
  const problemFor = (field: string) => fieldProblems.find((p) => p.field === field)?.message;

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold text-zinc-900">
        {isEdit ? "Edit listing" : "Create listing"}
      </h1>

      {error && <ErrorAlert message={error} className="mb-4" />}

      {fieldProblems.length > 0 && (
        <div className="mb-4">
          <FormErrorSummary errors={fieldProblems} />
        </div>
      )}

      {/* noValidate: the browser's own required-field blocking would otherwise stop a
          truly blank submit from ever reaching handleSubmit, so a keyboard/screen-reader
          user would see nothing happen at all rather than the summary below — the same
          reason login and register's forms already carry it. */}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <InputField
          id="listing-title"
          label="Title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Product title"
          error={problemFor("listing-title")}
          required
        />

        {/* A textarea, not an InputField: that renders a single-line input, and a 60-120
            word generated description is unusable in one. It still needs the same
            aria-invalid/aria-describedby wiring InputField does internally, hand-rolled
            here since there's no InputField error prop to lean on -- Title and Price
            already announce their own invalidity when tabbed to, and Description
            silently not doing the same in the same form would read as an oversight. */}
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
            aria-invalid={problemFor("listing-description") ? "true" : undefined}
            aria-describedby={
              problemFor("listing-description") ? "listing-description-error" : undefined
            }
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />

          {problemFor("listing-description") && (
            <p id="listing-description-error" role="alert" className="text-xs text-red-500">
              {problemFor("listing-description")}
            </p>
          )}

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
          id="listing-price"
          label="Price"
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder="0.00"
          error={problemFor("listing-price")}
          required
        />

        <ImageUploader
          files={files}
          existing={existingImages}
          onFilesChange={setFiles}
          onRemoveExisting={setPhotoPendingRemoval}
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

      {photoPendingRemoval !== null && (
        <Modal isOpen onClose={() => setPhotoPendingRemoval(null)} title="Remove this photo?">
          <p className="text-sm text-zinc-600">
            The photo is deleted straight away. Cancelling the form afterwards will not
            bring it back.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPhotoPendingRemoval(null)}>
              Keep photo
            </Button>
            <Button variant="danger" onClick={confirmRemoveExisting}>
              Remove photo
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
