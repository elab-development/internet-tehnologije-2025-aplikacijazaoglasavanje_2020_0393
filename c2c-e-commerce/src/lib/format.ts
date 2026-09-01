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
