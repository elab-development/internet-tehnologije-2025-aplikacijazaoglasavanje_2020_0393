"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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

export default function CreateListingPage() {
  const router = useRouter();
  const { user, loading, isAuthenticated } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!title.trim() || !description.trim() || !price.trim()) {
      setError("Title, description, and price are required");
      return;
    }

    setSubmitting(true);

    try {
      const created = await api.post<CreatedListing>("/api/listings", {
        title: title.trim(),
        description: description.trim(),
        price: Number(price),
        categoryId: categoryId ? Number(categoryId) : null,
      });

      router.push(`/listings/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create listing");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Checking permissions...</p>;
  }

  if (!isAuthenticated || (user?.role !== "seller" && user?.role !== "admin")) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold text-zinc-900">Create listing</h1>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
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

        <div className="pt-2">
          <Button type="submit" loading={submitting}>
            Create listing
          </Button>
        </div>
      </form>
    </div>
  );
}
