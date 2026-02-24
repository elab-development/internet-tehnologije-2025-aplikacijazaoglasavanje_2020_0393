import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { listings } from "./listings";
import { users } from "./users";

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    reviewerId: integer("reviewer_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    listingId: integer("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check("rating_range", sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
  ]
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
