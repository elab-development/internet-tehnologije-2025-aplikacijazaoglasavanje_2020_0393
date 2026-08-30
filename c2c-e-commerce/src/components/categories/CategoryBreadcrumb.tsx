import Link from "next/link";

import { ancestorChain } from "@/lib/categories";
import type { Category } from "@/types/api";

export type CategoryBreadcrumbProps = {
  categories: Category[];
  categoryId: number | null;
  /**
   * The listing's own category name, as already returned by the listing detail API's
   * join — a fallback for while `categories` has not arrived yet (or failed), so a
   * categorised listing does not read as "Uncategorized" just because a second, unrelated
   * fetch is slow.
   */
  fallbackName?: string | null;
};

/**
 * Where a listing sits in the taxonomy, root first.
 *
 * Every crumb links to a filtered browse, and since filtering by an ancestor includes
 * its descendants (spec §3.3), "Electronics" genuinely means everything electronic.
 */
export default function CategoryBreadcrumb({
  categories,
  categoryId,
  fallbackName,
}: CategoryBreadcrumbProps) {
  const chain = categoryId === null ? [] : ancestorChain(categories, categoryId);

  // Either the listing has no category, or the category list has not arrived yet (or
  // failed). The fallback name — already on the listing from the API's join — tells the
  // two apart: a name to show means the listing does have a category, just not a chain we
  // can render links for yet.
  if (chain.length === 0) {
    if (fallbackName) {
      return <span className="text-sm text-zinc-700">{fallbackName}</span>;
    }
    return <span className="text-sm text-zinc-500">Uncategorized</span>;
  }

  return (
    <nav aria-label="Category" className="flex flex-wrap items-center gap-1 text-sm">
      {chain.map((category, index) => (
        <span key={category.id} className="flex items-center gap-1">
          {index > 0 && <span className="text-zinc-300">›</span>}
          <Link
            href={`/listings?categoryId=${category.id}`}
            className="text-indigo-600 hover:underline"
          >
            {category.name}
          </Link>
        </span>
      ))}
    </nav>
  );
}
