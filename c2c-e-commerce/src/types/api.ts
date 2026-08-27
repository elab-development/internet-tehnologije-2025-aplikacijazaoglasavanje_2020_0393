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
  OrderItem as OrderItemRow,
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
> & { similarity?: number };

/** `GET /api/listings/[id]` — adds the joined seller and category names. */
export type ListingDetail = Listing & {
  sellerName: string | null;
  categoryName: string | null;
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

/** `GET /api/orders` */
export type Order = Serialized<OrderRow>;

/** An order line as returned by `GET /api/orders/[id]`. */
export type OrderItem = OrderItemRow & { listingTitle: string };

/** `GET /api/orders/[id]` — the order plus its lines. */
export type OrderDetail = Order & { items: OrderItem[] };

/** `POST /api/orders` — only the id is consumed by the UI. */
export type CreatedOrder = Pick<Order, "id">;

/** An order line as returned by `GET /api/orders/seller` (image included). */
export type SellerOrderItem = Pick<
  OrderItemRow,
  "id" | "listingId" | "quantity" | "price"
> & {
  listingTitle: string;
  listingImageUrl: string | null;
};

/** `GET /api/orders/seller` — the buyer is joined in, items are seller-scoped. */
export type SellerOrder = Order & {
  buyerName: string;
  buyerEmail: string;
  items: SellerOrderItem[];
};

// ─── Reviews ──────────────────────────────────────────────────────────────────

/** `GET /api/listings/[id]/reviews` — adds the joined reviewer name. */
export type Review = Serialized<ReviewRow> & { reviewerName: string | null };
