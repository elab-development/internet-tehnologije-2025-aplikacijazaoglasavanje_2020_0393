/**
 * C2C-QA-3 — row factories.
 *
 * Sensible defaults, everything overridable, and each factory creates whatever parent rows
 * it needs — so a test that only cares about listings need not spell out a seller and a
 * category first. Passing an explicit parent id reuses it rather than creating another,
 * which is what keeps row-counting assertions honest.
 */
import { eq } from "drizzle-orm";

import { applyRatingDelta } from "@/db/reviews";
import { hashPassword } from "@/lib/auth";
import { RESERVATION_HOURS } from "@/lib/order-lifecycle";
import { insertDelta } from "@/lib/reviews";
import {
  categories,
  listingImages,
  oauthAccounts,
  listings,
  orders,
  reviews,
  users,
  type Category,
  type ListingImage,
  type OAuthAccount,
  type Listing,
  type Order,
  type Review,
  type User,
} from "@/db/schema";

import { getTestDb } from "./db";

/**
 * Uniqueness for `users.email` and `categories.slug`.
 *
 * A counter rather than randomness: a failing run should reproduce. `resetDb()` restarts
 * identity sequences, so ids stay predictable while these values stay distinct within a
 * process.
 */
let sequence = 0;
const next = () => ++sequence;

export type MakeUserOptions = Partial<
  Pick<User, "email" | "name" | "role" | "phoneNumber" | "emailVerified" | "avatarUrl">
> & {
  /**
   * Hashed before insert; the plaintext is never stored. Pass `null` for an
   * OAuth-only account with no password at all (C2C-SEC-5).
   */
  password?: string | null;
};

export type MakeOAuthAccountOptions = Partial<
  Pick<OAuthAccount, "provider" | "providerAccountId" | "providerEmail">
> & {
  userId?: number;
};

export type MakeCategoryOptions = Partial<
  Pick<Category, "name" | "slug" | "description" | "sortOrder">
> & {
  /** Parent category. Omit or pass null for a root. */
  parentId?: number | null;
};

export type MakeListingOptions = Partial<
  Pick<Listing, "title" | "description" | "price" | "status">
> & {
  sellerId?: number;
  /** `null` creates a listing with no category — AI-9 AC7 has to cope with one. */
  categoryId?: number | null;
  embedding?: number[];
  embeddingUpdatedAt?: Date;
};

export type MakeListingImageOptions = Partial<
  Pick<ListingImage, "storageKey" | "contentType" | "byteSize" | "width" | "height" | "sortOrder">
> & {
  listingId?: number;
};

export type MakeOrderOptions = Partial<Pick<Order, "status" | "price">> & {
  buyerId?: number;
  /** Defaults to the listing's own seller, which is what a real order captures. */
  sellerId?: number;
  listingId?: number;
  /** Defaults to 48 hours from now. Pass a past date to make an order sweepable. */
  expiresAt?: Date;
};

export type MakeReviewOptions = Partial<Pick<Review, "rating" | "comment">> & {
  reviewerId?: number;
  /** The transaction being reviewed. Created if omitted. */
  orderId?: number;
  /**
   * Convenience for "a review of this listing": creates a completed order for it and
   * anchors the review to that. Ignored when `orderId` is given.
   */
  listingId?: number;
  /** For tests that care about the order of a timeline. */
  createdAt?: Date;
};

export async function makeUser(options: MakeUserOptions = {}): Promise<User> {
  const db = await getTestDb();
  const n = next();

  const [user] = await db
    .insert(users)
    .values({
      email: options.email ?? `user${n}@example.test`,
      name: options.name ?? `Test User ${n}`,
      passwordHash:
        options.password === null
          ? null
          : await hashPassword(options.password ?? "password123"),
      role: options.role ?? "buyer",
      phoneNumber: options.phoneNumber ?? null,
      emailVerified: options.emailVerified ?? false,
      avatarUrl: options.avatarUrl ?? null,
    })
    .returning();

  return user;
}

export async function makeCategory(options: MakeCategoryOptions = {}): Promise<Category> {
  const db = await getTestDb();
  const n = next();

  const parentId = options.parentId ?? null;

  // The parent's path is what the child's path is built from, so it has to be read
  // rather than assumed — a caller may have created the parent in an earlier test step.
  let parentPath: string | null = null;
  if (parentId !== null) {
    const [parent] = await db
      .select({ path: categories.path })
      .from(categories)
      .where(eq(categories.id, parentId))
      .limit(1);
    if (!parent) throw new Error(`makeCategory: parent ${parentId} does not exist`);
    parentPath = parent.path;
  }

  const depth = parentPath === null ? 0 : parentPath.split(".").length;

  // Insert with a placeholder path, then set it from the returned id: the row cannot
  // know its own id before it exists.
  const [inserted] = await db
    .insert(categories)
    .values({
      name: options.name ?? `Category ${n}`,
      slug: options.slug ?? `category-${n}`,
      description: options.description ?? null,
      parentId,
      path: "",
      depth,
      sortOrder: options.sortOrder ?? 0,
    })
    .returning();

  const path = parentPath === null ? String(inserted.id) : `${parentPath}.${inserted.id}`;

  const [category] = await db
    .update(categories)
    .set({ path })
    .where(eq(categories.id, inserted.id))
    .returning();

  return category;
}

export async function makeListing(options: MakeListingOptions = {}): Promise<Listing> {
  const db = await getTestDb();
  const n = next();

  // Only create what was not supplied. A factory that created a seller even when given
  // one would silently break any test counting users.
  const sellerId = options.sellerId ?? (await makeUser({ role: "seller" })).id;
  // `?? ` would treat an explicit null as "not supplied"; the caller means "no category".
  const categoryId =
    options.categoryId === undefined ? (await makeCategory()).id : options.categoryId;

  const [listing] = await db
    .insert(listings)
    .values({
      title: options.title ?? `Test Listing ${n}`,
      description: options.description ?? `Description for test listing ${n}`,
      price: options.price ?? "99.99",
      status: options.status ?? "active",
      sellerId,
      categoryId,
      embedding: options.embedding,
      // Only meaningful alongside a vector; AI-4 sets both together.
      embeddingUpdatedAt: options.embeddingUpdatedAt ?? (options.embedding ? new Date() : null),
    })
    .returning();

  return listing;
}

export async function makeListingImage(
  options: MakeListingImageOptions = {},
): Promise<ListingImage> {
  const db = await getTestDb();
  const n = next();

  const listingId = options.listingId ?? (await makeListing()).id;

  const [image] = await db
    .insert(listingImages)
    .values({
      listingId,
      // Shaped like a real key so a test that accidentally passes one to the storage
      // layer gets a realistic answer rather than an immediate validation error.
      storageKey:
        options.storageKey ?? `listings/${listingId}/${n.toString(16).padStart(32, "0")}.webp`,
      contentType: options.contentType ?? "image/webp",
      byteSize: options.byteSize ?? 1024,
      width: options.width ?? 800,
      height: options.height ?? 600,
      sortOrder: options.sortOrder ?? 0,
    })
    .returning();

  return image;
}

export async function makeOrder(options: MakeOrderOptions = {}): Promise<Order> {
  const db = await getTestDb();

  const buyerId = options.buyerId ?? (await makeUser({ role: "buyer" })).id;
  const listingId = options.listingId ?? (await makeListing()).id;

  const [listing] = await db
    .select({ price: listings.price, sellerId: listings.sellerId })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!listing) throw new Error(`makeOrder: listing ${listingId} does not exist`);

  const [order] = await db
    .insert(orders)
    .values({
      buyerId,
      sellerId: options.sellerId ?? listing.sellerId,
      listingId,
      price: options.price ?? listing.price,
      status: options.status ?? "completed",
      // Node's clock rather than Postgres's, uniquely here: a test that wants a lapsed
      // reservation has to be able to pass a date, and mixing `sql` with a Date in one
      // optional argument buys nothing a factory needs.
      expiresAt:
        options.expiresAt ??
        new Date(Date.now() + RESERVATION_HOURS * 60 * 60 * 1000),
    })
    .returning();

  return order;
}

/**
 * A review, its order, and the seller's aggregates, all consistent.
 *
 * The aggregate write is not optional politeness: `users.review_count` is what
 * `GET /api/users/{id}/reviews` paginates on, so a factory that wrote the review alone
 * would leave every test reading a seller with reviews and a count of zero — and the
 * tests that caught it would blame the route.
 */
export async function makeReview(options: MakeReviewOptions = {}): Promise<Review> {
  const db = await getTestDb();

  const reviewerId = options.reviewerId ?? (await makeUser({ role: "buyer" })).id;
  const orderId =
    options.orderId ??
    (
      await makeOrder({
        buyerId: reviewerId,
        status: "completed",
        ...(options.listingId !== undefined ? { listingId: options.listingId } : {}),
      })
    ).id;

  // Read rather than assumed: a caller may have supplied an order this factory did not
  // create, and the subject of a review is whoever sold that order.
  const [order] = await db
    .select({ sellerId: orders.sellerId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) throw new Error(`makeReview: order ${orderId} does not exist`);

  // The reviews table carries CHECK (rating BETWEEN 1 AND 5); a default outside that
  // range would make the factory unusable.
  const rating = options.rating ?? 5;

  const [review] = await db
    .insert(reviews)
    .values({
      reviewerId,
      sellerId: order.sellerId,
      orderId,
      rating,
      comment: options.comment ?? "Solid.",
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
    })
    .returning();

  await applyRatingDelta(db, order.sellerId, insertDelta(rating));

  return review;
}

/**
 * Links an external identity to a user, creating the user if none is given.
 *
 * Defaults to Google with a distinct account id per call, so two links in one test do
 * not collide on the composite unique index unless a test means them to.
 */
export async function makeOAuthAccount(
  options: MakeOAuthAccountOptions = {},
): Promise<OAuthAccount> {
  const db = await getTestDb();
  const n = next();

  const userId = options.userId ?? (await makeUser({ password: null })).id;

  const [account] = await db
    .insert(oauthAccounts)
    .values({
      userId,
      provider: options.provider ?? "google",
      providerAccountId: options.providerAccountId ?? `provider-account-${n}`,
      providerEmail: options.providerEmail ?? `oauth${n}@example.test`,
    })
    .returning();

  return account;
}
