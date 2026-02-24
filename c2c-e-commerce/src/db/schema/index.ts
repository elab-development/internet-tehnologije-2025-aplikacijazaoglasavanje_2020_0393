import { relations } from "drizzle-orm";
import { categories } from "./categories";
import { listings } from "./listings";
import { orderItems } from "./order-items";
import { orders } from "./orders";
import { reviews } from "./reviews";
import { users } from "./users";

// ─── Re-exports ───────────────────────────────────────────────────────────────
export * from "./categories";
export * from "./listings";
export * from "./order-items";
export * from "./orders";
export * from "./reviews";
export * from "./users";

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  listings: many(listings),
  orders: many(orders),
  reviews: many(reviews),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  listings: many(listings),
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
  orderItems: many(orderItems),
  reviews: many(reviews),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  buyer: one(users, {
    fields: [orders.buyerId],
    references: [users.id],
  }),
  orderItems: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  listing: one(listings, {
    fields: [orderItems.listingId],
    references: [listings.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  reviewer: one(users, {
    fields: [reviews.reviewerId],
    references: [users.id],
  }),
  listing: one(listings, {
    fields: [reviews.listingId],
    references: [listings.id],
  }),
}));
