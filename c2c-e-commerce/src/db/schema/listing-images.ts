import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { listings } from "./listings";

export const listingImages = pgTable(
  "listing_images",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),

    /** Opaque key resolved by the configured StorageProvider. Never a filesystem path. */
    storageKey: text("storage_key").notNull(),

    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),

    /** Nullable: recorded when the re-encoder reports them, absent if it cannot. */
    width: integer("width"),
    height: integer("height"),

    /** Cover image is the lowest. */
    sortOrder: integer("sort_order").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("listing_images_listing_id_idx").on(table.listingId, table.sortOrder)],
);

export type ListingImage = typeof listingImages.$inferSelect;
export type NewListingImage = typeof listingImages.$inferInsert;
