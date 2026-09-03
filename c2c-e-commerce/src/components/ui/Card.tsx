import Image from "next/image";
import Link from "next/link";

import {
  SPINE_CLASS,
  TEXT_CLASS,
  TINT_CLASS,
  type CategoryHue,
} from "@/components/categories/categoryHue";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CardProps = {
  image?: string | null;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  /**
   * Where the card goes when opened. Renders the title as a link.
   *
   * Was an `onClick` that did a `router.push`, on a div with `role="button"` — which
   * flattened the heading and the footer buttons into the card's accessible name, and
   * lost middle-click and open-in-new-tab.
   */
  href?: string;
  className?: string;
  badge?: string;
  /**
   * The category this listing belongs to. Drives the spine down the left edge and
   * the tint behind a listing with no photo yet — the same hue the item keeps in
   * the seller table and on its order lines.
   *
   * Defaults to `none` (a neutral rule) rather than a colour, so a card rendered
   * without category context never claims to be in a category it is not.
   */
  hue?: CategoryHue;
  /** Small caps line above the title — the category name and the listing's age. */
  eyebrow?: React.ReactNode;
  /**
   * Skip `next/image`'s `/_next/image` optimizer and request `image` directly.
   *
   * The optimizer's internal fetch of a relative `src` sends no cookies — Next builds
   * that request with only `url`, `method` and `socket` — so it hits `/api/images/{id}`
   * anonymously. A `removed` or `draft` listing's image 404s for that request even to
   * its owner, and `/_next/image` turns that into a 500 for a page (the seller
   * dashboard) that legitimately shows non-active listings. Forwarding the cookie
   * instead is not an option: the optimizer's on-disk cache is keyed by `(url, width,
   * quality)` with no auth dimension, so a cached private image would be readable by
   * anyone hitting the same optimized URL.
   */
  unoptimized?: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Card({
  image,
  title,
  description,
  footer,
  href,
  className = "",
  badge,
  hue = "none",
  eyebrow,
  unoptimized = false,
}: CardProps) {
  return (
    <div
      className={[
        "group relative flex flex-col overflow-hidden border border-l-[6px] border-rule bg-surface",
        "transition-colors duration-100",
        SPINE_CLASS[hue],
        // Three sides, not `hover:border-ink`. That is the `border-color` shorthand,
        // and Tailwind emits hover variants after the base utilities — so it would
        // land on top of the spine's `border-left-color` and grey out the category
        // hue at exactly the moment someone reaches for the card.
        href ? "hover:border-t-ink hover:border-r-ink hover:border-b-ink" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Image area */}
      <div
        className={[
          "relative aspect-[4/3] w-full shrink-0 overflow-hidden",
          image ? "bg-inset" : TINT_CLASS[hue],
        ].join(" ")}
      >
        {image ? (
          <Image
            src={image}
            alt={title}
            fill
            unoptimized={unoptimized}
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 400px"
          />
        ) : (
          // This glyph is the only indication the listing has no photo — not decorative,
          // so it needs a real accessible name (as StarRating.tsx does for its glyphs)
          // rather than being hidden.
          <div
            className="flex h-full w-full items-center justify-center"
            role="img"
            aria-label="No image available"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-10 w-10 opacity-45 ${TEXT_CLASS[hue]}`}
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4.5" width="18" height="15" />
              <path d="m3 16 4.2-4.2a1.6 1.6 0 0 1 2.3 0L14 16" />
              <path d="m13.5 14 1.7-1.7a1.6 1.6 0 0 1 2.3 0L21 15.5" />
              <circle cx="8.4" cy="9" r="1.2" />
            </svg>
          </div>
        )}
        {badge && (
          <span className="eyebrow absolute left-0 top-3 bg-ink px-2.5 py-1 text-white">
            {badge}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3.5">
        {eyebrow && (
          <div className="flex items-center justify-between gap-2">{eyebrow}</div>
        )}
        <h3 className="line-clamp-2 text-xl">
          {href ? (
            <Link href={href} className="after:absolute after:inset-0 after:content-['']">
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        {description && (
          <p className="line-clamp-3 flex-1 text-sm text-ink-2">{description}</p>
        )}
      </div>

      {/* Footer slot */}
      {footer && (
        <div className="relative z-10 border-t border-rule px-4 py-3">{footer}</div>
      )}
    </div>
  );
}
