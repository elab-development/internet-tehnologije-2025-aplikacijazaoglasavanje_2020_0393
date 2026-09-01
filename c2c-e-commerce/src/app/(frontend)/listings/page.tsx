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
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAnnounce } from "@/components/ui/Announcer";
import MatchQuality from "@/components/listings/MatchQuality";
import CategoryTreeFilter from "@/components/categories/CategoryTreeFilter";
import { formatPrice } from "@/lib/format";
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
  const [categoryId, setCategoryId] = useState<number | null>(() => {
    const raw = searchParams.get("categoryId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") ?? "");
  // Smart search is off unless the URL says otherwise, so an existing link keeps behaving
  // exactly as it did (decision D8: the mode is additive).
  const [smartSearch, setSmartSearch] = useState(
    searchParams.get("mode") === "hybrid",
  );
  const [sort, setSort] = useState<SortOption>(
    (searchParams.get("sort") as SortOption) ?? "newest",
  );

  const { data: categoryData } = useFetch<Category[]>("/api/categories");
  const categories = useMemo(() => categoryData ?? [], [categoryData]);

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  // Semantic mode embeds the query, so a request per keystroke is a model call per
  // keystroke. 400 ms of quiet before anything goes out.
  const debouncedSearch = useDebouncedValue(search, 400);

  // Same reasoning as the search debounce: typing "1000" is four keystrokes, and each
  // one otherwise costs a request, a router.replace and a flip to skeletons.
  const debouncedMinPrice = useDebouncedValue(minPrice, 400);
  const debouncedMaxPrice = useDebouncedValue(maxPrice, 400);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "12");
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (categoryId !== null) params.set("categoryId", String(categoryId));
    if (debouncedMinPrice) params.set("minPrice", debouncedMinPrice);
    if (debouncedMaxPrice) params.set("maxPrice", debouncedMaxPrice);
    if (sort) params.set("sort", sort);
    // Only written when on: a keyword-mode URL stays byte-identical to what it was before
    // this story, so shared links keep working unchanged.
    if (smartSearch) params.set("mode", "hybrid");
    return params.toString();
  }, [
    page,
    debouncedSearch,
    categoryId,
    debouncedMinPrice,
    debouncedMaxPrice,
    sort,
    smartSearch,
  ]);

  // Keep the address bar in sync so filters survive a reload or a shared link.
  useEffect(() => {
    router.replace(`/listings?${query}`);
  }, [query, router]);

  const { data, loading, error } = useFetch<ListingsResponse>(
    `/api/listings?${query}`,
  );

  const announce = useAnnounce();

  // A screen reader user types a search term and the page silently replaces its
  // contents. Announce the count once the request settles.
  useEffect(() => {
    if (loading || !data) return;
    announce(`${data.total} ${data.total === 1 ? "listing" : "listings"} found`);
  }, [loading, data, announce]);

  // Stale results are kept under the error banner rather than cleared. With a debounced
  // search firing while someone is still typing, blanking the grid on a transient failure
  // is worse than showing slightly old rows and saying so (AI-8 AC5).
  const listings = data?.data ?? [];
  const totalPages = Math.max(1, data?.totalPages || 1);

  // Filters apply as they change; there is nothing to submit. This exists so pressing
  // Enter in the search field does not reload the page.
  function handleFiltersSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  function clearFilters() {
    setSmartSearch(false);
    setSearch("");
    setCategoryId(null);
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
            placeholder={
              smartSearch
                ? "Describe what you are looking for, e.g. a warm jacket for winter"
                : "Search by title"
            }
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              // Every sibling control does this. Search did not, and it is the one
              // that feeds a debounce, so a stale page number outlived the query.
              setPage(1);
            }}
            className="lg:col-span-2"
          />

          {/* Inside the filter grid, so it wraps with everything else instead of being
              placed beside it. */}
          <div
            data-testid="smart-search-control"
            className="flex min-w-0 items-end lg:col-span-2"
          >
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={smartSearch}
                onChange={(event) => {
                  setSmartSearch(event.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-medium">Smart search</span>
              <span className="text-zinc-500">— find by meaning</span>
            </label>
          </div>

          <div className="flex flex-col gap-1 lg:col-span-2">
            <span className="text-sm font-medium text-zinc-700">Category</span>
            <CategoryTreeFilter
              categories={categories}
              value={categoryId}
              onChange={(id) => {
                setCategoryId(id);
                setPage(1);
              }}
            />
          </div>

          <InputField
            label="Min price"
            type="number"
            placeholder="0"
            value={minPrice}
            onChange={(event) => {
              setMinPrice(event.target.value);
              setPage(1);
            }}
            min={0}
            step={0.01}
          />

          <InputField
            label="Max price"
            type="number"
            placeholder="1000"
            value={maxPrice}
            onChange={(event) => {
              setMaxPrice(event.target.value);
              setPage(1);
            }}
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
        smartSearch ? (
          <EmptyState
            icon={<RiSearchLine size={32} />}
            title="No listings match that description"
            description="Smart search looks for meaning rather than exact words. Try describing the item differently, or switch it off to search by title."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSmartSearch(false);
                  setPage(1);
                }}
              >
                Turn smart search off
              </Button>
            }
          />
        ) : (
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
        )
      ) : (
        <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listings.map((listing) => (
            <Card
              key={listing.id}
              title={listing.title}
              description={formatPrice(listing.price)}
              image={listing.coverImageId ? `/api/images/${listing.coverImageId}` : null}
              badge={
                listing.categoryId
                  ? (categoryMap.get(listing.categoryId) ?? "Uncategorized")
                  : "Uncategorized"
              }
              footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-900">
                    {formatPrice(listing.price)}
                  </span>
                  <MatchQuality similarity={listing.similarity} />
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
