// ─── Display formatting ───────────────────────────────────────────────────────
//
// Home for formatting values for display across the app -- prices, dates, avatars,
// and whatever else needs a single, consistent rendering rather than one hand-rolled
// per call site.

/**
 * Renders a listing or order price in the marketplace's base currency.
 *
 * Deliberately not `Intl.NumberFormat`: this reproduces byte-for-byte what nine
 * separate call sites rendered by hand, so adopting it is a pure de-duplication with
 * no visual change. Two of those sites had already drifted — they rendered "120.00"
 * with no symbol while the rest rendered "$120.00".
 *
 * Conversion into the user's chosen currency stays with `formatConverted` in
 * `useCurrencyConversion`; this is the base-currency rendering only.
 */
export function formatPrice(value: number | string): string {
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) return "$—";
  return `$${amount.toFixed(2)}`;
}

/**
 * Renders a timestamp for display (L18).
 *
 * Four call sites already rendered `new Date(...).toLocaleString()` (date and time);
 * one rendered `.toLocaleDateString()` (date only). This reproduces the majority format
 * rather than the minority one, so adopting it changes the single outlier — the review
 * timestamp in `SellerReviews` — rather than the four sites that already agreed.
 */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString();
}

/**
 * A stable, per-user placeholder avatar (L19).
 *
 * Three call sites each generated a dicebear "initials" avatar seeded on a *name* —
 * `user.name`, `seller.name`, `displayName` (itself a `name ?? "Seller #id"` fallback).
 * Two different strings for the same person (their own name in the navbar vs. a
 * "Seller #id" fallback elsewhere when the name was missing) produced two different
 * avatars for one user. The id is what is actually stable and unique per user, so it is
 * the seed here.
 */
export function avatarUrl(userId: number): string {
  return `https://api.dicebear.com/9.x/initials/svg?seed=${userId}`;
}
