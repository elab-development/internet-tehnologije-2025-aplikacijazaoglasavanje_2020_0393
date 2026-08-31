import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { listings } from "./listings";

/**
 * The unique index behind (listing_id, sort_order).
 *
 * Named here rather than inline so the string a handler matches on and the string the
 * migration creates cannot drift apart silently -- a mismatch makes the conflict branch
 * dead code and every happy-path test stays green.
 *
 * Defined here rather than in `src/db/listing-images.ts` (re-exported from there instead)
 * because that file already imports this schema module -- naming the constant there and
 * importing it back here would close an import cycle right where `pgTable`'s index
 * factory needs the value synchronously.
 */
export const LISTING_IMAGES_SORT_INDEX = "listing_images_listing_sort_idx";

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
  (table) => [
    index("listing_images_listing_id_idx").on(table.listingId, table.sortOrder),
    // Task 9's row lock serialises writers, but this index is the backstop that makes
    // the collision unrepresentable rather than merely unlikely -- declared here too, not
    // only in the migration, because `drizzle-kit push` reconciles a live database to
    // this file and never reads `drizzle/*.sql`.
    uniqueIndex(LISTING_IMAGES_SORT_INDEX).on(table.listingId, table.sortOrder),
  ],
);

export type ListingImage = typeof listingImages.$inferSelect;
export type NewListingImage = typeof listingImages.$inferInsert;
