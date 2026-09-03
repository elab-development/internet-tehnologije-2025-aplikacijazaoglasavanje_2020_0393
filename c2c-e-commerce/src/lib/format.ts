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
 * one rendered `.toLocaleDateString()` (date only). The rule this landed on is not "most
 * call sites win" — it is *kind of field*: the four agreeing sites are all transactional
 * (an order placed, a reservation expiring), where the minute genuinely matters. The one
 * outlier, a review's timestamp in `SellerReviews`, is a low-precision human event — the
 * exact second it was posted is noise, and the bare date was the better display before
 * this ever got consolidated. So the default stays date+time (unchanged for the four
 * transactional sites); `{ dateOnly: true }` is the opt-in for the one human-event site,
 * so it keeps its original display while still sharing this one function.
 */
export function formatDate(value: string | Date, options?: { dateOnly?: boolean }): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return options?.dateOnly ? date.toLocaleDateString() : date.toLocaleString();
}

/**
 * A stable, per-user placeholder avatar (L19, fix round 2).
 *
 * Three call sites each generated a dicebear "initials" avatar seeded on a *name* —
 * `user.name`, `seller.name`, `displayName` (itself a `name ?? "Seller #id"` fallback).
 * Two different strings for the same person (their own name in the navbar vs. a
 * "Seller #id" fallback elsewhere when the name was missing) produced two different
 * avatars for one user. The id is what is actually stable and unique per user, so it is
 * the seed here — that part of the round-1 fix was right.
 *
 * What round 1 got wrong: it kept the dicebear `initials` *style*, which draws its
 * glyphs from the seed itself. Seeded on a numeric id, that style renders literal
 * digits ("42") instead of a person's initials — consistent, but meaningless. `thumbs`
 * (a stylized face/avatar mark) is a style whose output is meant to look arbitrary and
 * whose input can safely be an opaque id, so a numeric seed is no longer a defect. This
 * keeps the one-argument, id-only signature so all three call sites are unaffected.
 */
export function avatarUrl(userId: number): string {
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${userId}`;
}
