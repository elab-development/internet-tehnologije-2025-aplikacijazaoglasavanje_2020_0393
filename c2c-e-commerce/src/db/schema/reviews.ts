import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { orders } from "./orders";
import { users } from "./users";

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    reviewerId: integer("reviewer_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /**
     * The subject of the review (D6).
     *
     * Denormalised from the order rather than reached through it, for the same reason
     * `orders.seller_id` is: a seller's reviews become one indexed read instead of a
     * two-table join, and a later listing edit cannot retroactively change who was
     * reviewed.
     */
    sellerId: integer("seller_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /** The transaction the review is about, and the uniqueness key: one review per order. */
    orderId: integer("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check("rating_range", sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
    uniqueIndex("reviews_one_per_order_idx").on(table.orderId),
    index("reviews_seller_id_idx").on(table.sellerId),
  ]
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
