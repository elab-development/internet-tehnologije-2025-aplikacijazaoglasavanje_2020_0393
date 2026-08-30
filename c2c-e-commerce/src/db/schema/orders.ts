import { sql } from "drizzle-orm";
import { integer, numeric, pgEnum, pgTable, serial, timestamp } from "drizzle-orm/pg-core";

import { ORDER_STATUSES } from "@/lib/order-lifecycle";

import { listings } from "./listings";
import { users } from "./users";

/**
 * Derived from the graph rather than repeated beside it.
 *
 * The old file listed the seven values a second time with a comment asking the next
 * reader to keep them in sync, which is the arrangement that let `PURCHASED_ORDER_STATUSES`
 * drift into a rule nothing enforced.
 */
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  buyerId: integer("buyer_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  /**
   * Denormalised from the listing at order time, deliberately (spec §5.1).
   *
   * It turns the seller dashboard into a column filter instead of an ownership
   * reconciliation, makes review eligibility a single-table predicate, and means a later
   * listing edit cannot retroactively change who a past transaction was with.
   */
  sellerId: integer("seller_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  /** RESTRICT: deleting a bought listing would delete the record of the purchase. */
  listingId: integer("listing_id")
    .references(() => listings.id, { onDelete: "restrict" })
    .notNull(),
  /** Captured at order time. With one listing per order, the price is the total. */
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  /**
   * Superseded by `price` and removed in 0016. It stays in the model, nullable, only so
   * the four files that still read it keep compiling while each moves in its own task —
   * the seller route, both order pages and one test's direct insert.
   */
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }),
  status: orderStatusEnum("status").default("pending").notNull(),
  /**
   * When the reservation lapses (D3). Set from Postgres's clock at creation, never from
   * Node's: the container and the host disagree on this project's dev machines, and a
   * deadline read from the wrong one expires orders early or never.
   *
   * No default: an order without a deadline is a listing held forever, so the writer has
   * to say when.
   */
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
