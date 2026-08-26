/**
 * C2C-QA-3 — row factories.
 *
 * SPEC PHASE SKELETON. Sensible defaults, everything overridable, and each factory
 * creates whatever parent rows it needs so a test can ask for one listing without
 * spelling out a seller and a category first.
 */
import type {
  Category,
  Listing,
  Order,
  Review,
  User,
} from "@/db/schema";

const NOT_IMPLEMENTED = "not implemented — C2C-QA-3 is in its spec phase";

export type MakeUserOptions = Partial<
  Pick<User, "email" | "name" | "role" | "phoneNumber">
> & {
  /** Hashed before insert; the plaintext is never stored. */
  password?: string;
};

export type MakeCategoryOptions = Partial<Pick<Category, "name" | "slug" | "description">>;

export type MakeListingOptions = Partial<
  Pick<Listing, "title" | "description" | "price" | "status" | "imageUrl">
> & {
  sellerId?: number;
  categoryId?: number;
  embedding?: number[];
  embeddingUpdatedAt?: Date;
};

export type MakeOrderOptions = Partial<Pick<Order, "status" | "totalPrice">> & {
  buyerId?: number;
  listingIds?: number[];
};

export type MakeReviewOptions = Partial<Pick<Review, "rating" | "comment">> & {
  reviewerId?: number;
  listingId?: number;
};

export function makeUser(_options?: MakeUserOptions): Promise<User> {
  throw new Error(NOT_IMPLEMENTED);
}

export function makeCategory(_options?: MakeCategoryOptions): Promise<Category> {
  throw new Error(NOT_IMPLEMENTED);
}

export function makeListing(_options?: MakeListingOptions): Promise<Listing> {
  throw new Error(NOT_IMPLEMENTED);
}

export function makeOrder(_options?: MakeOrderOptions): Promise<Order> {
  throw new Error(NOT_IMPLEMENTED);
}

export function makeReview(_options?: MakeReviewOptions): Promise<Review> {
  throw new Error(NOT_IMPLEMENTED);
}
