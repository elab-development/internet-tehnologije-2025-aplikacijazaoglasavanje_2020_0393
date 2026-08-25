"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Metadata } from "next";
import { RiSearchLine } from "@remixicon/react";
import {
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  InputField,
  ListingCardSkeleton,
} from "@/components/ui";
import { useFetch } from "@/hooks/useFetch";
import type { Category, ListingsResponse } from "@/types/api";

export const _metadata: Pick<Metadata, "title"> = {
  title: "Listings",
};

type SortOption = "newest" | "price_asc" | "price_desc";

function ListingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [page, setPage] = useState(() => {
    const raw = Number(searchParams.get("page") ?? "1");
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  });
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [categoryId, setCategoryId] = useState(
    searchParams.get("categoryId") ?? "",
  );
  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") ?? "");
  const [sort, setSort] = useState<SortOption>(
    (searchParams.get("sort") as SortOption) ?? "newest",
  );

  const { data: categoryData } = useFetch<Category[]>("/api/categories");
  const categories = useMemo(() => categoryData ?? [], [categoryData]);

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "12");
    if (search.trim()) params.set("search", search.trim());
    if (categoryId) params.set("categoryId", categoryId);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    if (sort) params.set("sort", sort);
    return params.toString();
  }, [page, search, categoryId, minPrice, maxPrice, sort]);

  // Keep the address bar in sync so filters survive a reload or a shared link.
  useEffect(() => {
    router.replace(`/listings?${query}`);
  }, [query, router]);

  const { data, loading, error } = useFetch<ListingsResponse>(
    `/api/listings?${query}`,
  );

  // A failed request clears the grid rather than leaving stale results under
  // the error banner.
  const listings = error ? [] : (data?.data ?? []);
  const totalPages = error ? 1 : Math.max(1, data?.totalPages || 1);

  function handleFiltersSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setCategoryId("");
    setMinPrice("");
    setMaxPrice("");
    setSort("newest");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <form
          onSubmit={handleFiltersSubmit}
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-6"
        >
          <InputField
            label="Search"
            type="search"
            placeholder="Search by title"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="lg:col-span-2"
          />

          <div className="flex flex-col gap-1">
            <label
              className="text-sm font-medium text-zinc-700"
              htmlFor="category-filter"
            >
              Category
            </label>
            <select
              id="category-filter"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={String(category.id)}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <InputField
            label="Min price"
            type="number"
            placeholder="0"
            value={minPrice}
            onChange={(event) => setMinPrice(event.target.value)}
            min={0}
            step={0.01}
          />

          <InputField
            label="Max price"
            type="number"
            placeholder="1000"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
            min={0}
            step={0.01}
          />

          <div className="flex flex-col gap-1">
            <label
              className="text-sm font-medium text-zinc-700"
              htmlFor="sort-filter"
            >
              Sort
            </label>
            <select
              id="sort-filter"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as SortOption);
                setPage(1);
              }}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="newest">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>

          <div className="flex items-end gap-2 md:col-span-2 lg:col-span-6">
            <Button type="submit">Apply filters</Button>
            <Button type="button" variant="secondary" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        </form>
      </section>

      {error && <ErrorAlert message={error} />}

      {loading ? (
        <section
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-label="Loading listings"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <ListingCardSkeleton key={i} />
          ))}
        </section>
      ) : listings.length === 0 ? (
        <EmptyState
          icon={<RiSearchLine size={32} />}
          title="No listings found"
          description="Try adjusting your filters or search terms to find what you are looking for."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listings.map((listing) => (
            <Card
              key={listing.id}
              title={listing.title}
              description={`$${Number(listing.price).toFixed(2)}`}
              image={listing.imageUrl}
              badge={
                listing.categoryId
                  ? (categoryMap.get(listing.categoryId) ?? "Uncategorized")
                  : "Uncategorized"
              }
              footer={
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-900">
                    ${Number(listing.price).toFixed(2)}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => router.push(`/listings/${listing.id}`)}
                  >
                    View
                  </Button>
                </div>
              }
            />
          ))}
        </section>
      )}

      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4">
        <Button
          variant="secondary"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <span className="text-sm text-zinc-600">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="secondary"
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          disabled={page >= totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function ListingsPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center py-20 text-zinc-400">
          Loading listings...
        </div>
      }
    >
      <ListingsPageContent />
    </Suspense>
  );
}
