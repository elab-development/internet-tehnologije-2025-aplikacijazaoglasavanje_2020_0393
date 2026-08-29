import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
} from "drizzle-orm/pg-core";

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").unique().notNull(),
    description: text("description"),

    // The self-reference needs an explicit AnyPgColumn return type: without it
    // TypeScript cannot infer a circular reference and the file fails to compile.
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "restrict",
    }),

    /** Ancestor ids including self, dot-separated: '3', '3.7', '3.7.12'. */
    path: text("path").notNull(),

    /** 0 for roots. Derivable from `path`, stored so the CHECK below can exist. */
    depth: integer("depth").default(0).notNull(),

    /** Curated order within a parent — alphabetical is wrong for a taxonomy. */
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    index("categories_path_prefix_idx").on(table.path),
    check("categories_depth_range", sql`${table.depth} >= 0 AND ${table.depth} <= 2`),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
