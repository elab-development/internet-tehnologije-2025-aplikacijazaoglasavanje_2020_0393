import type { Category } from "@/types/api";

/**
 * Colour means category, and it means nothing else.
 *
 * The five hues are owned by the five top-level categories. A listing hangs off a
 * leaf ("Electronics › Phones"), so the hue comes from the leaf's root ancestor —
 * `path` is the dot-separated ancestor chain with the root id first, which is the
 * only thing that survives however deep the taxonomy grows.
 *
 * `none` is a real answer, not a failure: a listing in a category this palette has
 * not been given a hue for gets the neutral rule rather than borrowing a colour
 * that already means something else.
 */
export type CategoryHue =
  | "electronics"
  | "clothing"
  | "home"
  | "books"
  | "sports"
  | "none";

const HUE_BY_ROOT_SLUG: Record<string, CategoryHue> = {
  electronics: "electronics",
  clothing: "clothing",
  "home-garden": "home",
  books: "books",
  sports: "sports",
};

/**
 * Class literals, written out in full rather than composed from a hue name.
 * Tailwind scans source text for class names, so `border-l-cat-${hue}` would
 * compile to nothing at all.
 */
export const SPINE_CLASS: Record<CategoryHue, string> = {
  electronics: "border-l-cat-electronics",
  clothing: "border-l-cat-clothing",
  home: "border-l-cat-home",
  books: "border-l-cat-books",
  sports: "border-l-cat-sports",
  none: "border-l-rule-strong",
};

/** The same spine, turned along the top edge — for panels that sit beside content
 *  rather than in a grid of cards. */
export const TOP_SPINE_CLASS: Record<CategoryHue, string> = {
  electronics: "border-t-cat-electronics",
  clothing: "border-t-cat-clothing",
  home: "border-t-cat-home",
  books: "border-t-cat-books",
  sports: "border-t-cat-sports",
  none: "border-t-ink",
};

export const TEXT_CLASS: Record<CategoryHue, string> = {
  electronics: "text-cat-electronics",
  clothing: "text-cat-clothing",
  home: "text-cat-home",
  books: "text-cat-books",
  sports: "text-cat-sports",
  none: "text-ink-3",
};

export const FILL_CLASS: Record<CategoryHue, string> = {
  electronics: "bg-cat-electronics",
  clothing: "bg-cat-clothing",
  home: "bg-cat-home",
  books: "bg-cat-books",
  sports: "bg-cat-sports",
  none: "bg-ink-3",
};

/** The empty-photo stand-in: tinted so a listing with no upload still belongs somewhere. */
export const TINT_CLASS: Record<CategoryHue, string> = {
  electronics: "bg-cat-electronics-tint",
  clothing: "bg-cat-clothing-tint",
  home: "bg-cat-home-tint",
  books: "bg-cat-books-tint",
  sports: "bg-cat-sports-tint",
  none: "bg-cat-none-tint",
};

/** The hue a top-level category owns, by its slug. */
export function hueForSlug(slug: string | null | undefined): CategoryHue {
  if (!slug) return "none";
  return HUE_BY_ROOT_SLUG[slug] ?? "none";
}

/**
 * Builds a resolver over one category list.
 *
 * Returned as a closure rather than a `(id, categories)` function because callers
 * resolve a hue per row in a grid — rebuilding the id index on every card turned a
 * lookup into a scan of the whole taxonomy.
 */
export function makeHueResolver(
  categories: Category[],
): (categoryId: number | null | undefined) => CategoryHue {
  const byId = new Map(categories.map((category) => [category.id, category]));

  return (categoryId) => {
    if (categoryId === null || categoryId === undefined) return "none";
    const category = byId.get(categoryId);
    if (!category) return "none";

    const rootId = Number(category.path.split(".")[0]);
    const root = byId.get(rootId) ?? category;
    return hueForSlug(root.slug);
  };
}

/** The five top-level categories, in their curated order. */
export function rootCategories(categories: Category[]): Category[] {
  return categories
    .filter((category) => category.depth === 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
