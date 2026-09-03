/**
 * C2C-SEC-5 spec — external identities.
 *
 * The `users` table assumes every account has a password; OAuth-only accounts do not.
 * External identities become their own table so one user can hold several, and
 * `password_hash` becomes nullable.
 *
 * Migration numbers: the story says 0008/0009, written before SEC-2 took 0008. These are
 * **0009** (oauth_accounts) and **0010** (users columns).
 */
import { eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { oauthAccounts, users } from "@/db/schema";
import {
  getTestDb,
  migrateTestDb,
  resetDb,
  stopTestDatabase,
  testPool,
} from "@/test/db";
import { makeOAuthAccount, makeUser } from "@/test/factories";

let pool: Pool;

beforeAll(async () => {
  await migrateTestDb();
  pool = await testPool();
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await stopTestDatabase();
});

async function column(table: string, name: string) {
  const { rows } = await pool.query(
    `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, name],
  );
  return rows[0] as
    | { data_type: string; is_nullable: "YES" | "NO"; column_default: string | null }
    | undefined;
}

describe("C2C-SEC-5 AC1 — the oauth_accounts table", () => {
  it("exists with the columns the story names", async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'oauth_accounts'
        ORDER BY column_name`,
    );

    expect(rows.map((r) => r.column_name)).toEqual([
      "created_at",
      "id",
      "provider",
      "provider_account_id",
      "provider_email",
      "user_id",
    ]);
  });

  it("requires user_id, provider and provider_account_id", async () => {
    for (const name of ["user_id", "provider", "provider_account_id"]) {
      expect(await column("oauth_accounts", name), name).toMatchObject({
        is_nullable: "NO",
      });
    }
  });

  it("leaves provider_email nullable — GitHub can withhold it", async () => {
    expect(await column("oauth_accounts", "provider_email")).toMatchObject({
      is_nullable: "YES",
    });
  });

  it("carries a composite unique constraint on (provider, provider_account_id)", async () => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'oauth_accounts'`,
    );

    // Keyed on the provider's account id, not the email: an account id is stable while
    // an email can be changed at the provider.
    expect(
      rows.some(
        (r) =>
          /UNIQUE/i.test(r.indexdef) &&
          /provider/.test(r.indexdef) &&
          /provider_account_id/.test(r.indexdef),
      ),
      `no composite unique index among: ${rows.map((r) => r.indexdef).join(" | ")}`,
    ).toBe(true);
  });
});

describe("C2C-SEC-5 AC2 — the users columns", () => {
  it("makes password_hash nullable", async () => {
    expect(await column("users", "password_hash")).toMatchObject({
      is_nullable: "YES",
    });
  });

  it("adds email_verified, NOT NULL, defaulting to false", async () => {
    const col = await column("users", "email_verified");

    expect(col).toMatchObject({ is_nullable: "NO", data_type: "boolean" });
    expect(col?.column_default).toMatch(/false/i);
  });

  it("adds avatar_url", async () => {
    expect(await column("users", "avatar_url")).toMatchObject({
      is_nullable: "YES",
    });
  });
});

describe("C2C-SEC-5 — constraints", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("AC3: an existing password user survives the migration with email_verified false", async () => {
    // These users registered with a password this app never verified. Claiming their
    // address is verified would be a lie the linking policy in SEC-8 then trusts.
    const user = await makeUser();

    expect(user.emailVerified).toBe(false);
    expect(user.passwordHash).not.toBeNull();
  });

  it("AC4: the same (provider, provider_account_id) cannot be stored twice", async () => {
    const user = await makeUser();
    await makeOAuthAccount({ userId: user.id, provider: "google", providerAccountId: "abc" });

    await expect(
      makeOAuthAccount({ userId: user.id, provider: "google", providerAccountId: "abc" }),
    ).rejects.toThrow();
  });

  it("AC5: the same account id under two providers is fine", async () => {
    const user = await makeUser();

    await makeOAuthAccount({ userId: user.id, provider: "google", providerAccountId: "12345" });
    await expect(
      makeOAuthAccount({ userId: user.id, provider: "github", providerAccountId: "12345" }),
    ).resolves.toBeDefined();
  });

  it("AC6: deleting a user cascades to their linked identities", async () => {
    const user = await makeUser();
    await makeOAuthAccount({ userId: user.id });
    const db = await getTestDb();

    await db.delete(users).where(eq(users.id, user.id));

    expect(await db.select().from(oauthAccounts)).toHaveLength(0);
  });

  it("AC8: an unknown provider is rejected by the database, not just by TypeScript", async () => {
    const user = await makeUser();
    const db = await getTestDb();

    // Raw SQL deliberately: the point is that the constraint holds even when the
    // application layer is bypassed.
    await expect(
      db.execute(sql`
        INSERT INTO oauth_accounts (user_id, provider, provider_account_id)
        VALUES (${user.id}, 'facebook', 'nope')
      `),
    ).rejects.toThrow();
  });

  it("stores a user with no password at all", async () => {
    // The whole reason password_hash became nullable.
    const user = await makeUser({ password: null });

    expect(user.passwordHash).toBeNull();
  });

  it("lets one user hold several providers", async () => {
    const user = await makeUser({ password: null });
    await makeOAuthAccount({ userId: user.id, provider: "google" });
    await makeOAuthAccount({ userId: user.id, provider: "github" });

    const db = await getTestDb();
    const row = await db.query.users.findFirst({ with: { oauthAccounts: true } });

    expect(row?.oauthAccounts).toHaveLength(2);
  });
});
