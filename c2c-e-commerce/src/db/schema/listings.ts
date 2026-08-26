import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";

import { categories } from "./categories";
import { users } from "./users";

export const listingStatusEnum = pgEnum("listing_status", [
  "active",
  "sold",
  "removed",
]);

export const listings = pgTable(
  "listings",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    imageUrl: text("image_url"),
    status: listingStatusEnum("status").default("active").notNull(),
    sellerId: integer("seller_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),

    // Added by C2C-AI-4. The backfill's staleness query is
    // `embedding_updated_at < updated_at`, and no table in this schema had an updated_at
    // before — the query AI-4 AC5 specifies could not be written at all.
    //
    // $onUpdate stamps it on every Drizzle update, so a route that forgets cannot leave
    // a listing's text newer than the timestamp that is supposed to track it.
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),

    // Nullable on purpose: a listing must stay creatable when embedding fails (AI-4 AC2),
    // and AI-7 uses `embedding IS NOT NULL` to keep such rows out of the vector arm while
    // leaving them findable by keyword.
    //
    // The width comes from the constant rather than a literal, so the schema follows the
    // model if it ever changes. Migration 0006 deliberately does the opposite.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),

    // When the vector was last computed, so a backfill can find stale rows.
    embeddingUpdatedAt: timestamp("embedding_updated_at"),
  },
  (table) => [
    // Mirrors migration 0006. HNSW needs no training step and no minimum row count;
    // vector_cosine_ops because AI-2 emits unit vectors.
    index("listings_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
