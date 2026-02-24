"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Metadata } from "next";
import toast from "react-hot-toast";
import { RiSearchLine } from "@remixicon/react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import InputField from "@/components/ui/InputField";
import { ListingCardSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";

export const _metadata: Pick<Metadata, "title"> = {
  title: "Listings",
};

type Listing = {
  id: number;
  title: string;
  description: string;
  price: string;
  categoryId: number | null;
};

type Category = {
  id: number;
  name: string;
};

type ListingsResponse = {
  data: Listing[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type SortOption = "newest" | "price_asc" | "price_desc";

function ListingsPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [listings, setListings] = useState<Listing[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState(1);

    const [page, setPage] = useState(() => {
    const raw = Number(searchParams.get("page") ?? "1");
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
    });
    const [search, setSearch] = useState(searchParams.get("search") ?? "");
    const [categoryId, setCategoryId] = useState(searchParams.get("categoryId") ?? "");
    const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") ?? "");
    const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") ?? "");
    const [sort, setSort] = useState<SortOption>(
    (searchParams.get("sort") as SortOption) ?? "newest"
    );

    const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories]
    );

    useEffect(() => {
    api
    .get<Category[]>("/api/categories")
    .then(setCategories)
    .catch(() => setCategories([]));
    }, []);

    useEffect(() => {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("limit", "12");
    if (search.trim()) query.set("search", search.trim());
    if (categoryId) query.set("categoryId", categoryId);
    if (minPrice) query.set("minPrice", minPrice);
    if (maxPrice) query.set("maxPrice", maxPrice);
    if (sort) query.set("sort", sort);

    router.replace(`/listings?${query.toString()}`);

    api
    .get<ListingsResponse>(`/api/listings?${query.toString()}`)
    .then((response) => {
    setError(null);
    setListings(response.data);
    setTotalPages(Math.max(1, response.totalPages || 1));
    })
    .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "Failed to load listings";
    setError(msg);
    toast.error(msg);
    setListings([]);
    setTotalPages(1);
    })
    .finally(() => setLoading(false));
    }, [page, search, categoryId, minPrice, maxPrice, sort, router]);

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
            <form onSubmit={handleFiltersSubmit} className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
                <InputField
                label="Search"
                type="search"
                placeholder="Search by title"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="lg:col-span-2"
                />

                <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-zinc-700" htmlFor="category-filter">
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
                    <label className="text-sm font-medium text-zinc-700" htmlFor="sort-filter">
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

        {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="shrink-0 mt-0.5">⚠️</span>
            <span>{error}</span>
        </div>
        )}

        {loading ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Loading listings">
            {Array.from({ length: 8 }).map((_, i) => (
            <ListingCardSkeleton key={i} />
            ))}
        </section>
        ) : listings.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
            <RiSearchLine size={32} />
            </span>
            <p className="text-lg font-semibold text-zinc-700">No listings found</p>
            <p className="text-sm text-zinc-500 max-w-xs">Try adjusting your filters or search terms to find what you&apos;re looking for.</p>
            <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
        </div>
        ) : (
        <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map((listing) => (
            <Card
                key={listing.id}
                title={listing.title}
                description={`$${Number(listing.price).toFixed(2)}`}
                badge={
                listing.categoryId ? categoryMap.get(listing.categoryId) ?? "Uncategorized" : "Uncategorized"
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
    <Suspense fallback={<div className="text-center py-20 text-zinc-400">Loading listings...</div>}>
      <ListingsPageContent />
    </Suspense>
  );
}
