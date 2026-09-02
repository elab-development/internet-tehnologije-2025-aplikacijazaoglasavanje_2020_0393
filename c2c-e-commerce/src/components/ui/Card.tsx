import Image from "next/image";
import Link from "next/link";

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
  unoptimized = false,
}: CardProps) {
  return (
    <div
      className={[
        "group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm",
        "transition-shadow duration-200",
        href ? "hover:shadow-md" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Image area */}
      <div className="relative h-52 w-full shrink-0 overflow-hidden bg-zinc-100">
        {image ? (
          <Image
            src={image}
            alt={title}
            fill
            unoptimized={unoptimized}
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, 400px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {/* Decorative placeholder-image glyph, not content — contrast-exempt. */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-14 w-14 text-zinc-300"
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}
        {badge && (
          <span className="absolute left-3 top-3 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow">
            {badge}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="line-clamp-2 font-semibold text-zinc-900">
          {href ? (
            <Link
              href={href}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        {description && (
          <p className="line-clamp-3 flex-1 text-sm text-zinc-500">
            {description}
          </p>
        )}
      </div>

      {/* Footer slot */}
      {footer && (
        <div className="relative z-10 border-t border-zinc-100 px-4 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}
