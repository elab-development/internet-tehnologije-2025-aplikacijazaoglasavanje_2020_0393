"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import Button from "@/components/ui/Button";
import InputField from "@/components/ui/InputField";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

type Category = {
  id: number;
  name: string;
};

type CreatedListing = {
  id: number;
};

const listingStatuses = ["active", "sold", "removed"] as const;

type ListingStatus = (typeof listingStatuses)[number];

type ListingDetail = {
  id: number;
  title: string;
  description: string;
  price: string;
  imageUrl: string | null;
  categoryId: number | null;
  sellerId: number;
  status: ListingStatus;
};

function CreateListingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, isAuthenticated } = useAuth();

  const rawEditId = searchParams.get("id");
  const editId = rawEditId ? parseInt(rawEditId, 10) : null;
  const isEditMode = editId !== null && !isNaN(editId) && editId > 0;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<ListingStatus>("active");

  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [fetchingListing, setFetchingListing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (!isAuthenticated) {
        router.replace("/login");
        return;
      }

      if (user?.role !== "seller" && user?.role !== "admin") {
        router.replace("/");
      }
    }
  }, [loading, isAuthenticated, user, router]);

  useEffect(() => {
    api
      .get<Category[]>("/api/categories")
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  // Fetch existing listing data when in edit mode
  useEffect(() => {
    if (!isEditMode || loading) return;

    setFetchingListing(true);
    api
      .get<ListingDetail>(`/api/listings/${editId}`)
      .then((listing) => {
        setTitle(listing.title);
        setDescription(listing.description);
        setPrice(String(Number(listing.price)));
        setImageUrl(listing.imageUrl ?? "");
        setCategoryId(listing.categoryId ? String(listing.categoryId) : "");
        setStatus(listing.status);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load listing";
        setError(msg);
        toast.error(msg);
      })
      .finally(() => setFetchingListing(false));
  }, [isEditMode, editId, loading]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!title.trim() || !description.trim() || !price.trim()) {
      setError("Title, description, and price are required");
      return;
    }

    setSubmitting(true);

    try {
      if (isEditMode) {
        await api.put(`/api/listings/${editId}`, {
          title: title.trim(),
          description: description.trim(),
          price: Number(price),
          imageUrl: imageUrl.trim() || null,
          categoryId: categoryId ? Number(categoryId) : null,
          status,
        });

        toast.success("Listing updated successfully!");
        router.push(`/listings/${editId}`);
      } else {
        const created = await api.post<CreatedListing>("/api/listings", {
          title: title.trim(),
          description: description.trim(),
          price: Number(price),
          imageUrl: imageUrl.trim() || null,
          categoryId: categoryId ? Number(categoryId) : null,
        });

        toast.success("Listing created successfully!");
        router.push(`/listings/${created.id}`);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : isEditMode
          ? "Failed to update listing"
          : "Failed to create listing";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || fetchingListing) {
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

  if (!isAuthenticated || (user?.role !== "seller" && user?.role !== "admin")) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold text-zinc-900">
        {isEditMode ? "Edit listing" : "Create listing"}
      </h1>

      {error && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="shrink-0 mt-0.5">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <InputField
          label="Title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Product title"
          required
        />

        <InputField
          label="Description"
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Product description"
          required
        />

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

        <InputField
          label="Image URL"
          type="text"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
          placeholder="https://example.com/image.jpg"
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700" htmlFor="create-category">
            Category
          </label>
          <select
            id="create-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {isEditMode && (
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
              onChange={(event) => setStatus(event.target.value as ListingStatus)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            >
              {listingStatuses.map((listingStatus) => (
                <option key={listingStatus} value={listingStatus}>
                  {listingStatus.charAt(0).toUpperCase() + listingStatus.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          {isEditMode && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/listings/${editId}`)}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" loading={submitting}>
            {isEditMode ? "Save changes" : "Create listing"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function CreateListingPageWrapper() {
  return (
    <Suspense>
      <CreateListingPage />
    </Suspense>
  );
}
