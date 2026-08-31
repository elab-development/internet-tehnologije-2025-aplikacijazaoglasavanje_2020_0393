export type StarRatingProps = {
  /** The mean, or null for a seller nobody has reviewed. */
  value: number | null;
  /** How many reviews the mean is drawn from. Omitted where it is shown elsewhere. */
  count?: number;
  size?: "sm" | "md";
};

const SIZES = { sm: "text-sm", md: "text-lg" } as const;

/**
 * Five stars, filled to the nearest whole point.
 *
 * `null` is not zero. A seller with no reviews has no rating, and five empty stars reads
 * as five one-star ones — so that case gets words instead. The exact value stays in the
 * accessible label, because rounding to whole stars loses it.
 */
export default function StarRating({ value, count, size = "md" }: StarRatingProps) {
  if (value === null) {
    return <span className="text-sm text-zinc-500">No reviews yet</span>;
  }

  const filled = Math.round(value);

  return (
    <span className={`inline-flex items-center gap-1 ${SIZES[size]}`}>
      <span
        className="text-amber-500"
        aria-label={`Rated ${Number(value.toFixed(1))} out of 5`}
        role="img"
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} data-star={star}>
            {star <= filled ? "★" : "☆"}
          </span>
        ))}
      </span>
      {count !== undefined && (
        <span className="text-sm text-zinc-500">({count})</span>
      )}
    </span>
  );
}
