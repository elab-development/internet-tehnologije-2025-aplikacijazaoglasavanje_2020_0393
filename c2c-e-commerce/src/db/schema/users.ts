import {
  boolean,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["buyer", "seller", "admin"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique().notNull(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
