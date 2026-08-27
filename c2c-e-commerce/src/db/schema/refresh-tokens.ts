import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Rotating refresh tokens (C2C-SEC-2).
 *
 * `tokenHash` stores a SHA-256 digest, never the token: a database leak must not hand
 * out live sessions. bcrypt would be the wrong tool — the token is already 32 bytes of
 * CSPRNG output, so there is no low-entropy secret to slow an attacker down against, and
 * refresh sits on a hot path where a deliberately slow hash costs real latency.
 *
 * `familyId` is what makes reuse detection possible. Every token descended from one
 * login shares it, so presenting an already-rotated token — which means either a buggy
 * client or a stolen token, and you cannot tell which — lets the whole chain be revoked
 * at once.
 *
 * `replacedById` records the successor, making the chain auditable after the fact.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    familyId: uuid("family_id").notNull(),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    /** Set when revoked; the row is kept so a later replay is still detectable. */
    revokedAt: timestamp("revoked_at"),
    /** The token this one was rotated into. Self-referential, hence the AnyPgColumn. */
    replacedById: integer("replaced_by_id").references(
      (): AnyPgColumn => refreshTokens.id,
      { onDelete: "set null" },
    ),
    /** Best-effort provenance for the audit trail; absent for clients that send neither. */
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (table) => [
    // Unique: the lookup on every refresh, and the constraint that makes a replayed
    // hash impossible to insert twice.
    uniqueIndex("refresh_tokens_token_hash_idx").on(table.tokenHash),
    index("refresh_tokens_user_id_idx").on(table.userId),
    // Revoking a family happens on the security-critical path; it must not scan.
    index("refresh_tokens_family_id_idx").on(table.familyId),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
