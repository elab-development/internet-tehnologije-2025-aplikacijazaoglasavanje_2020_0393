import { relations } from "drizzle-orm";
import { categories } from "./categories";
import { listingImages } from "./listing-images";
import { listings } from "./listings";
import { oauthAccounts } from "./oauth-accounts";
import { orders } from "./orders";
import { refreshTokens } from "./refresh-tokens";
import { reviews } from "./reviews";
import { users } from "./users";

// ─── Re-exports ───────────────────────────────────────────────────────────────
export * from "./categories";
export * from "./listing-images";
export * from "./listings";
export * from "./oauth-accounts";
export * from "./orders";
export * from "./refresh-tokens";
export * from "./reviews";
export * from "./users";

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  listings: many(listings),
  orders: many(orders),
  // A user now stands in two different relationships to `reviews` — the reviews they
  // wrote and the reviews written about them — so a single `many(reviews)` is ambiguous:
  // Drizzle resolves it by finding the *unique* matching `one(users)` on the other side,
  // and `reviewsRelations` now has two. Named to say which is which.
  reviewsWritten: many(reviews, { relationName: "reviewAuthor" }),
  reviewsReceived: many(reviews, { relationName: "reviewSubject" }),
  refreshTokens: many(refreshTokens),
  oauthAccounts: many(oauthAccounts),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, {
    fields: [oauthAccounts.userId],
    references: [users.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  listings: many(listings),
}));

export const listingImagesRelations = relations(listingImages, ({ one }) => ({
  listing: one(listings, {
    fields: [listingImages.listingId],
    references: [listings.id],
  }),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  seller: one(users, {
    fields: [listings.sellerId],
    references: [users.id],
  }),
  category: one(categories, {
    fields: [listings.categoryId],
    references: [categories.id],
  }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  buyer: one(users, {
    fields: [orders.buyerId],
    references: [users.id],
  }),
  seller: one(users, {
    fields: [orders.sellerId],
    references: [users.id],
  }),
  listing: one(listings, {
    fields: [orders.listingId],
    references: [listings.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  reviewer: one(users, {
    fields: [reviews.reviewerId],
    references: [users.id],
    relationName: "reviewAuthor",
  }),
  seller: one(users, {
    fields: [reviews.sellerId],
    references: [users.id],
    relationName: "reviewSubject",
  }),
  order: one(orders, {
    fields: [reviews.orderId],
    references: [orders.id],
  }),
}));
