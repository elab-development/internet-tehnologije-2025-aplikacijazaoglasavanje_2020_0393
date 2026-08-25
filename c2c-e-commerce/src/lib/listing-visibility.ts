import type { TokenPayload } from "@/lib/auth";

// ─── Listing visibility rules ─────────────────────────────────────────────────
// Decides which listings a caller of GET /api/listings is allowed to see.
//
// Kept as a pure function, separate from the route, because this is the security
// boundary for the endpoint and needs to be exhaustively testable. Route files
// may only export HTTP handlers, so it cannot live there.

export type ListingVisibility = {
  /** When false, the query must be restricted to status = "active". */
  includeAllStatuses: boolean;
  /** Seller id to filter on, or null for no seller restriction. */
  sellerFilter: number | null;
};

/**
 * @param rawSellerId the `sellerId` query param, exactly as supplied (may be
 *                    null, empty, or non-numeric — all are treated as absent)
 * @param payload     the authenticated caller, or null for anonymous access
 */
export function resolveListingVisibility(
  rawSellerId: string | null,
  payload: TokenPayload | null
): ListingVisibility {
  // Strict parse on purpose: parseInt is prefix-tolerant ("7abc" -> 7), and a
  // security boundary should not quietly reinterpret malformed input.
  const hasSellerFilter = /^-?\d+$/.test(rawSellerId?.trim() ?? "");
  const sellerId = hasSellerFilter ? Number(rawSellerId!.trim()) : NaN;
  const isAdmin = payload?.role === "admin";

  // Admins deliberately see listings from every seller, so their seller filter
  // is dropped rather than applied (see commit 8e5d326).
  if (isAdmin) {
    return {
      includeAllStatuses: hasSellerFilter,
      sellerFilter: null,
    };
  }

  // Sold/removed listings are private inventory — visible only to their owner.
  const isOwnInventory = hasSellerFilter && payload?.sub === sellerId;

  return {
    includeAllStatuses: isOwnInventory,
    sellerFilter: hasSellerFilter ? sellerId : null,
  };
}
