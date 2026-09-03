"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import {
  makeHueResolver,
  TEXT_CLASS,
} from "@/components/categories/categoryHue";
import { formatDate, formatPrice } from "@/lib/format";
import type { Category, ListingsResponse } from "@/types/api";

const SORT_OPTIONS = ["newest", "price_asc", "price_desc"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

/** What the results header says the grid is ordered by. */
const SORT_LABELS: Record<SortOption, string> = {
  newest: "newest first",
  price_asc: "price, low to high",
  price_desc: "price, high to low",
};

/**
 * Cast, previously: `?sort=oldest` produced a dropdown reading "Newest" (the
 * `useState` initializer's default) over results the server sorted by whatever the
 * raw, unvalidated query string actually said (L9).
 */
function parseSort(raw: string | null): SortOption {
  return (SORT_OPTIONS as readonly string[]).includes(raw ?? "")
    ? (raw as SortOption)
    : "newest";
}

function ListingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [page, setPage] = useState(() => {
    const raw = Number(searchParams.get("page") ?? "1");
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  });
  // Remembers which `data` payload the stale-page clamp below has already reacted to, so
  // it fires once per fetch rather than looping.
  const [clampedFor, setClampedFor] = useState<ListingsResponse | null>(null);
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
  const [sort, setSort] = useState<SortOption>(() =>
    parseSort(searchParams.get("sort")),
  );

  const { data: categoryData } = useFetch<Category[]>("/api/categories");
  const categories = useMemo(() => categoryData ?? [], [categoryData]);

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  // Which of the five hues each listing's category rolls up to. Built once per
  // category list rather than per card — a grid of twelve otherwise walked the
  // whole taxonomy twelve times.
  const hueOf = useMemo(() => makeHueResolver(categories), [categories]);

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

  // `page` is seeded from the URL, so a deep link to ?page=4 can outlive the result set it
  // was valid for. Adjusted here during render rather than in a `useEffect` — an effect
  // that reads `page` to decide whether to call `setPage` is exactly the "setState
  // synchronously within an effect" pattern the `react-hooks/set-state-in-effect` lint rule
  // flags, because it is state derived from other state rather than a sync with an
  // external system (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // `clampedFor` guards against looping: it remembers which `data` payload this has already
  // reacted to, so it fires once per fetch rather than on every render. Every in-app filter
  // control already calls setPage(1) itself, so this only fires for a stale link or
  // bookmark — but without it the pager is hidden (L20) and there is no way back to page 1
  // except clearing the search.
  if (!loading && data && data !== clampedFor && page > totalPages) {
    setClampedFor(data);
    setPage(1);
  }

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
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-[1.5px] border-ink pb-3">
        <div className="flex items-baseline gap-4">
          <h1 className="text-4xl">Browse listings</h1>
          {!loading && data && (
            <span className="text-sm text-ink-3">
              {data.total} {data.total === 1 ? "listing" : "listings"}
            </span>
          )}
        </div>
        <span className="eyebrow text-ink-3">Sorted by {SORT_LABELS[sort]}</span>
      </div>

      <section
        aria-labelledby="filters-heading"
        className="rounded-none border border-rule bg-white p-4 shadow-none"
      >
        <h2 id="filters-heading" className="sr-only">
          Filters
        </h2>
        {/* Two regions, not one six-column grid. The category tree is six rows tall
            and every other control is one row, so a single grid stretched row 1 to the
            tree's height and left a block of dead space under the search field. */}
        <form
          onSubmit={handleFiltersSubmit}
          className="grid gap-6 lg:grid-cols-[1fr_260px]"
        >
          <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-6">
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
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={smartSearch}
                onChange={(event) => {
                  setSmartSearch(event.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded-none border-rule-strong text-ink focus:ring-ink"
              />
              <span className="font-medium">Smart search</span>
              <span className="text-ink-3">— find by meaning</span>
            </label>
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

          <div className="flex flex-col gap-2">
            <label className="eyebrow text-ink-2" htmlFor="sort-filter">
              Sort
            </label>
            <select
              id="sort-filter"
              value={sort}
              onChange={(event) => {
                setSort(parseSort(event.target.value));
                setPage(1);
              }}
              className="border-[1.5px] border-rule-strong bg-surface px-3.5 py-3 text-sm text-ink transition-colors focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--ink)] focus:outline-none"
            >
              <option value="newest">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>

            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:border-l lg:border-rule lg:pl-6">
            <span className="eyebrow text-ink-2">Category</span>
            <CategoryTreeFilter
              categories={categories}
              value={categoryId}
              onChange={(id) => {
                setCategoryId(id);
                setPage(1);
              }}
            />
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
        <section
          aria-labelledby="results-heading"
          className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <h2 id="results-heading" className="sr-only">
            Results
          </h2>
          {listings.map((listing) => (
            <Card
              key={listing.id}
              title={listing.title}
              // The description, not the price. The price used to be printed here
              // and again in the footer, which left the card with no room for the
              // one thing only the seller can tell you about the item.
              description={listing.description ?? undefined}
              image={listing.coverImageId ? `/api/images/${listing.coverImageId}` : null}
              hue={hueOf(listing.categoryId)}
              href={`/listings/${listing.id}`}
              eyebrow={
                <>
                  <span
                    className={`text-[10.5px] font-bold uppercase tracking-[0.12em] ${TEXT_CLASS[hueOf(listing.categoryId)]}`}
                  >
                    {listing.categoryId
                      ? (categoryMap.get(listing.categoryId) ?? "Uncategorized")
                      : "Uncategorized"}
                  </span>
                  <span className="text-[11px] text-ink-3">
                    {formatDate(listing.createdAt, { dateOnly: true })}
                  </span>
                </>
              }
              footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="figure text-xl text-ink">
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

      {/* Hidden rather than left below the empty state (L20): with zero results and one
          page there is nowhere for these controls to take you, and rendering them below
          `EmptyState`'s centered placeholder pushed them off-screen on a page someone
          reached by paging forward into an empty result. */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-none border border-rule bg-white p-4">
          <Button
            variant="secondary"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-ink-2">
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
      )}
    </div>
  );
}

export default function ListingsPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center py-20 text-ink-3">
          Loading listings...
        </div>
      }
    >
      <ListingsPageContent />
    </Suspense>
  );
}
