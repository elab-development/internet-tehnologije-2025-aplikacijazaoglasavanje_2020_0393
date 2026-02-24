import { integer, numeric, pgTable, serial } from "drizzle-orm/pg-core";
import { listings } from "./listings";
import { orders } from "./orders";

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .notNull(),
  listingId: integer("listing_id")
    .references(() => listings.id, { onDelete: "restrict" })
    .notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").default(1).notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
