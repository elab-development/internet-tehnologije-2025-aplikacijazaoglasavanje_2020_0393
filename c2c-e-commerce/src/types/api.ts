// ─── Shared API response types ────────────────────────────────────────────────
// Derived from the Drizzle schema so the frontend cannot silently drift from the
// database. Two things stop these from being the raw row types:
//
//   • JSON has no Date — `timestamp` columns arrive as ISO strings.
//   • Several endpoints return joined extras (sellerName, buyerEmail, items…).
//
// Model those as transformations of the inferred row types rather than
// redeclaring fields by hand.

import type {
  Category as CategoryRow,
  Listing as ListingRow,
  Order as OrderRow,
  Review as ReviewRow,
} from "@/db/schema";

/** A row as it survives `JSON.stringify` — `createdAt` becomes an ISO string. */
type Serialized<T extends { createdAt: Date }> = Omit<T, "createdAt"> & {
  createdAt: string;
};

/** Envelope returned by the paginated list endpoints. */
export type Paginated<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

// ─── Categories ───────────────────────────────────────────────────────────────

/** `GET /api/categories` */
export type Category = CategoryRow;

// ─── Listings ─────────────────────────────────────────────────────────────────

export type ListingStatus = ListingRow["status"];

/**
 * A listing row as returned by `GET /api/listings`.
 *
 * The two embedding columns are stripped: they are server-side only, and the API projects
 * them out (see `listingColumns`). Declaring them here would let a component read a field
 * that is never sent.
 *
 * `similarity` is present only in the `semantic` and `hybrid` search modes, and only on
 * rows that reached the vector arm — AI-7 omits it rather than sending 0 for a row matched
 * by keyword alone.
 */
export type Listing = Omit<
  Serialized<ListingRow>,
  "embedding" | "embeddingUpdatedAt"
> & { similarity?: number; coverImageId: number | null };

/** One photo, as the API exposes it. The bytes come from `/api/images/{id}`. */
export type ListingImageSummary = {
  id: number;
  sortOrder: number;
  width: number | null;
  height: number | null;
};

/** `GET /api/listings/[id]` — adds the joined seller and category names. */
export type ListingDetail = Listing & {
  sellerName: string | null;
  categoryName: string | null;
  images: ListingImageSummary[];
};

/** `GET /api/listings/[id]/similar` — a listing plus how close it is to the source. */
export type SimilarListing = Listing & { similarity: number };

/** `GET /api/recommendations` — the strategy says whether this is personal or popular. */
export type RecommendationsResponse = {
  data: Listing[];
  strategy: "personalised" | "popular";
};

/** `GET /api/listings` */
export type ListingsResponse = Paginated<Listing>;

/** `POST /api/listings` — only the id is consumed by the UI. */
export type CreatedListing = Pick<Listing, "id">;

// ─── Orders ───────────────────────────────────────────────────────────────────

export type OrderStatus = OrderRow["status"];

/**
 * `GET /api/orders`.
 *
 * Three timestamps rather than one: `expiresAt` is when the reservation lapses and
 * `updatedAt` is when the status last moved, and both arrive as ISO strings like
 * `createdAt`.
 */
export type Order = Omit<Serialized<OrderRow>, "expiresAt" | "updatedAt"> & {
  expiresAt: string;
  updatedAt: string;
};

/** `GET /api/orders/[id]` — the order plus the listing it is for. */
export type OrderDetail = Order & {
  listingTitle: string;
  coverImageId: number | null;
};

/** `POST /api/orders` — only the id is consumed by the UI. */
export type CreatedOrder = Pick<Order, "id">;

/** `GET /api/orders/seller` — the buyer and the listing are joined in. */
export type SellerOrder = Order & {
  buyerName: string;
  buyerEmail: string;
  listingTitle: string;
  coverImageId: number | null;
};

// ─── Reviews ──────────────────────────────────────────────────────────────────

/** A review row as returned by the reviews API, with the joined reviewer name. */
export type Review = Serialized<ReviewRow> & { reviewerName: string | null };
