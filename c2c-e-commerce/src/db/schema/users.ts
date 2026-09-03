import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { USERS_EMAIL_LOWER_INDEX } from "../users";

export const userRoleEnum = pgEnum("user_role", ["buyer", "seller", "admin"]);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    /**
     * Uniqueness is enforced below by `users_email_lower_idx`, a case-insensitive
     * expression index, not by a column-level constraint here. Declaring `.unique()` on
     * top of it would create a second, redundant exact-match constraint -- exactly the
     * one migration 0019 drops, because with both present Postgres reports an
     * exact-case duplicate against the older constraint, not this one, and
     * `isUniqueViolation` in the register route stops matching.
     */
    email: text("email").notNull(),
    /**
     * Null for accounts that authenticate only through an external provider
     * (C2C-SEC-5). Every reader must handle null -- see the login route, where doing so
     * naively leaks account existence through response timing.
     */
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    phoneNumber: text("phone_number"),
    role: userRoleEnum("role").default("buyer").notNull(),
    /**
     * Whether the address has actually been proved. False for every password account:
     * this app has never run an email verification flow, and SEC-8's linking policy
     * depends on not pretending otherwise.
     */
    emailVerified: boolean("email_verified").default(false).notNull(),
    avatarUrl: text("avatar_url"),
    /**
     * Denormalised reputation (D7). Two integers, so every update is exact and the mean is
     * derived — a stored average drifts the moment one write is missed, and nothing ever
     * tells you which write it was. Maintained in the same transaction as every review
     * write; see `src/db/reviews.ts`.
     */
    reviewCount: integer("review_count").default(0).notNull(),
    ratingSum: integer("rating_sum").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Declared here, not just created by migration 0019, so `drizzle-kit push` -- which
    // reconciles a live database to this file and never reads `drizzle/*.sql` -- sees the
    // same invariant the migration does instead of proposing to drop it. The name comes
    // from the shared constant so the schema and the route's `isUniqueViolation` check
    // cannot name two different indexes.
    uniqueIndex(USERS_EMAIL_LOWER_INDEX).on(sql`lower(${table.email})`),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
