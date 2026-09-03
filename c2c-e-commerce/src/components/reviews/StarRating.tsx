export type StarRatingProps = {
  /** The mean, or null for a seller nobody has reviewed. */
  value: number | null;
  /** How many reviews the mean is drawn from. Omitted where it is shown elsewhere. */
  count?: number;
  size?: "sm" | "md";
};

const SIZES = { sm: 13, md: 17 } as const;

const STAR_PATH =
  "m12 3.4 2.7 5.7 6.2.9-4.5 4.3 1.1 6.2-5.5-2.9-5.5 2.9 1.1-6.2-4.5-4.3 6.2-.9Z";

/**
 * Five stars, filled to the nearest whole point.
 *
 * `null` is not zero. A seller with no reviews has no rating, and five empty stars reads
 * as five one-star ones — so that case gets words instead. The exact value stays in the
 * accessible label, because rounding to whole stars loses it.
 *
 * Drawn as SVG rather than the ★/☆ glyphs it used to use: those render in whatever
 * shape and weight the platform's emoji font decides, and a half-filled row of them
 * was the one place in the interface where an icon was a character. `data-filled`
 * carries what the glyph difference used to, so the fill is still assertable.
 */
export default function StarRating({ value, count, size = "md" }: StarRatingProps) {
  if (value === null) {
    return <span className="text-sm text-ink-3">No reviews yet</span>;
  }

  const filled = Math.round(value);
  const px = SIZES[size];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center gap-0.5"
        aria-label={`Rated ${Number(value.toFixed(1))} out of 5`}
        role="img"
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = star <= filled;
          return (
            <span
              key={star}
              data-star={star}
              data-filled={isFilled ? "true" : "false"}
              className={isFilled ? "text-ink" : "text-rule-strong"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={px}
                height={px}
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill={isFilled ? "currentColor" : "none"}
                stroke={isFilled ? "none" : "currentColor"}
                strokeWidth={1.5}
                strokeLinejoin="round"
              >
                <path d={STAR_PATH} />
              </svg>
            </span>
          );
        })}
      </span>
      {count !== undefined && <span className="text-sm text-ink-3">({count})</span>}
    </span>
  );
}
