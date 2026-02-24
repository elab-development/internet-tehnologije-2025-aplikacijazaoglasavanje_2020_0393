import {
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { categories } from "./categories";
import { users } from "./users";

export const listingStatusEnum = pgEnum("listing_status", [
  "active",
  "sold",
  "removed",
]);

export const listings = pgTable("listings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  imageUrl: text("image_url"),
  status: listingStatusEnum("status").default("active").notNull(),
  sellerId: integer("seller_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  categoryId: integer("category_id")
    .references(() => categories.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
