import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Providers this app federates with (C2C-SEC-5).
 *
 * A database enum rather than a bare `text`, so an unrecognised provider is rejected
 * even when the application layer is bypassed.
 */
export const oauthProviderEnum = pgEnum("oauth_provider", ["google", "github"]);

/**
 * External identities. One user may hold several.
 *
 * The unique key is `(provider, provider_account_id)` and deliberately **not** the
 * email: a provider's account id is stable, while the address behind it can be changed
 * by the user at any time. Keying on email would let someone change their address at
 * the provider and collide with — or detach from — an existing link.
 */
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    provider: oauthProviderEnum("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    /** Nullable: GitHub returns no email when the user has hidden it. */
    providerEmail: text("provider_email"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("oauth_accounts_provider_account_idx").on(
      table.provider,
      table.providerAccountId,
    ),
  ],
);

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;
export type OAuthProvider = (typeof oauthProviderEnum.enumValues)[number];
