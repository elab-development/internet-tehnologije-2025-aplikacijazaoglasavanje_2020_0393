/**
 * C2C-QA-3 — row factories.
 *
 * Sensible defaults, everything overridable, and each factory creates whatever parent rows
 * it needs — so a test that only cares about listings need not spell out a seller and a
 * category first. Passing an explicit parent id reuses it rather than creating another,
 * which is what keeps row-counting assertions honest.
 */
import { eq } from "drizzle-orm";

import { hashPassword } from "@/lib/auth";
import {
  categories,
  listingImages,
  oauthAccounts,
  listings,
  orderItems,
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

export type MakeOrderOptions = Partial<Pick<Order, "status" | "totalPrice">> & {
  buyerId?: number;
  listingIds?: number[];
};

export type MakeReviewOptions = Partial<Pick<Review, "rating" | "comment">> & {
  reviewerId?: number;
  listingId?: number;
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
  const listingIds = options.listingIds ?? [(await makeListing()).id];

  const rows = await db
    .select({ id: listings.id, price: listings.price })
    .from(listings);
  const priceOf = new Map(rows.map((row) => [row.id, row.price]));

  const total = listingIds.reduce(
    (sum, id) => sum + Number(priceOf.get(id) ?? 0),
    0,
  );

  const [order] = await db
    .insert(orders)
    .values({
      buyerId,
      totalPrice: options.totalPrice ?? total.toFixed(2),
      status: options.status ?? "completed",
    })
    .returning();

  // AI-10 walks order_items -> orders.buyerId to build a taste vector, so the join rows
  // have to exist, not merely be implied by the order.
  await db.insert(orderItems).values(
    listingIds.map((listingId) => ({
      orderId: order.id,
      listingId,
      price: priceOf.get(listingId) ?? "0.00",
      quantity: 1,
    })),
  );

  return order;
}

export async function makeReview(options: MakeReviewOptions = {}): Promise<Review> {
  const db = await getTestDb();

  const reviewerId = options.reviewerId ?? (await makeUser({ role: "buyer" })).id;
  const listingId = options.listingId ?? (await makeListing()).id;

  const [review] = await db
    .insert(reviews)
    .values({
      reviewerId,
      listingId,
      // The reviews table carries CHECK (rating BETWEEN 1 AND 5); a default outside that
      // range would make the factory unusable.
      rating: options.rating ?? 5,
      comment: options.comment ?? "Solid.",
    })
    .returning();

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
