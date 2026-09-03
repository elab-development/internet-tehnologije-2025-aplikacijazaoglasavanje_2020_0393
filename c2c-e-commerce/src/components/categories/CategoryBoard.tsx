"use client";

import Link from "next/link";

import { useFetch } from "@/hooks/useFetch";
import type { Category } from "@/types/api";
import { FILL_CLASS, hueForSlug, rootCategories } from "./categoryHue";

/**
 * One glyph per top-level category, on the 24 grid the rest of the icon set uses.
 * Keyed by slug rather than by index so reordering the taxonomy cannot silently
 * hand Books the bicycle.
 */
const ICONS: Record<string, React.ReactNode> = {
  electronics: (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" />
      <path d="M9 20h6" />
      <path d="M12 16.5V20" />
    </>
  ),
  clothing: (
    <path d="M8.5 3.5 5 5.5 3.5 9.5l3 1.2V20.5h11V10.7l3-1.2L19 5.5l-3.5-2a3.5 3.5 0 0 1-7 0Z" />
  ),
  "home-garden": (
    <>
      <path d="M3.5 10.5 12 4l8.5 6.5V20h-17Z" />
      <path d="M9.5 20v-6.5h5V20" />
    </>
  ),
  books: (
    <>
      <path d="M6 3.5h11a1 1 0 0 1 1 1v15H6.5A2.5 2.5 0 0 0 4 21.5V6a2.5 2.5 0 0 1 2.5-2.5Z" />
      <path d="M4 19h14" />
    </>
  ),
  sports: (
    <>
      <circle cx="6" cy="17" r="3.4" />
      <circle cx="18" cy="17" r="3.4" />
      <path d="m6 17 4-8h5" />
      <path d="m10.5 9 4 8" />
      <path d="M13.5 6h3" />
    </>
  ),
};

/**
 * The market directory: five colour tiles, no gaps, one continuous band.
 *
 * Renders nothing at all until the categories arrive, and nothing if the request
 * fails — a board of five grey rectangles says less than no board, and the page
 * below it stands on its own. Errors are silent for the same reason: a visitor
 * cannot act on "the category list did not load".
 */
export default function CategoryBoard() {
  const { data } = useFetch<Category[]>("/api/categories", { onError: "silent" });

  const roots = rootCategories(data ?? []);
  if (roots.length === 0) return null;

  return (
    <nav aria-label="Browse by category" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
      {roots.map((category) => {
        const hue = hueForSlug(category.slug);
        return (
          <Link
            key={category.id}
            href={`/listings?categoryId=${category.id}`}
            className={`flex h-44 flex-col justify-between p-5 text-white no-underline transition-opacity hover:opacity-90 lg:h-52 ${FILL_CLASS[hue]}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={24}
              height={24}
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {ICONS[category.slug] ?? <circle cx="12" cy="12" r="8" />}
            </svg>
            <span className="font-display text-2xl font-bold leading-tight tracking-[-0.02em]">
              {category.name}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
