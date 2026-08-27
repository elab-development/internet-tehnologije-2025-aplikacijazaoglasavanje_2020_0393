/**
 * C2C-SEC-2 spec — the `refresh_tokens` table.
 *
 * Storage only. Issuance, rotation and reuse detection are SEC-3; this pins the shape
 * that makes them possible: a hashed token, a `family_id` that ties one login's whole
 * chain together, and a `replaced_by_id` that makes the chain auditable.
 *
 * The column assertions read `information_schema` rather than inserting and hoping,
 * because nullability is the part that matters here and an insert only proves the
 * columns it happens to touch.
 *
 * Migration number: the backlog says `0007_create_refresh_tokens.sql`, written before
 * the AI epic landed. 0005-0007 are taken (pgvector, listing embedding, listing
 * updated_at), so this is **0008**.
 */
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { refreshTokens, users } from "@/db/schema";
import {
  getTestDb,
  migrateTestDb,
  resetDb,
  stopTestDatabase,
  testPool,
} from "@/test/db";
import { makeUser } from "@/test/factories";

let pool: Pool;

beforeAll(async () => {
  await migrateTestDb();
  pool = await testPool();
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await stopTestDatabase();
});

/** One column's declared type and nullability, straight from the catalogue. */
async function column(name: string) {
  const { rows } = await pool.query(
    `SELECT data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'refresh_tokens' AND column_name = $1`,
    [name],
  );
  return rows[0] as { data_type: string; is_nullable: "YES" | "NO" } | undefined;
}

/** A future expiry, so a row is live unless a test says otherwise. */
const soon = () => new Date(Date.now() + 60 * 60 * 1000);

const FAMILY = "11111111-1111-4111-8111-111111111111";

describe("C2C-SEC-2 AC1 — the table and its ten columns", () => {
  it("the table exists", async () => {
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'refresh_tokens'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("has exactly the ten columns the story names, and no more", async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
        ORDER BY column_name`,
    );

    expect(rows.map((r) => r.column_name)).toEqual([
      "expires_at",
      "family_id",
      "id",
      "ip",
      "issued_at",
      "replaced_by_id",
      "revoked_at",
      "token_hash",
      "user_agent",
      "user_id",
    ]);
  });

  it("makes user_id, token_hash, family_id, issued_at and expires_at NOT NULL", async () => {
    for (const name of ["user_id", "token_hash", "family_id", "issued_at", "expires_at"]) {
      expect(await column(name), `${name} is missing`).toMatchObject({ is_nullable: "NO" });
    }
  });

  it("leaves revoked_at, replaced_by_id, user_agent and ip nullable", async () => {
    // A freshly issued token is not revoked, has no successor, and may come from a
    // client that sent neither a User-Agent nor a resolvable address.
    for (const name of ["revoked_at", "replaced_by_id", "user_agent", "ip"]) {
      expect(await column(name), `${name} is missing`).toMatchObject({ is_nullable: "YES" });
    }
  });

  it("types family_id as uuid and the timestamps as timestamps", async () => {
    expect(await column("family_id")).toMatchObject({ data_type: "uuid" });

    for (const name of ["issued_at", "expires_at", "revoked_at"]) {
      expect(await column(name), `${name} is missing`).toMatchObject({
        data_type: expect.stringContaining("timestamp"),
      });
    }
  });

  it("defaults issued_at to now(), so a row cannot be written without one", async () => {
    expect(await column("issued_at")).toMatchObject({ is_nullable: "NO" });

    const user = await makeUser();
    const db = await getTestDb();
    const [row] = await db
      .insert(refreshTokens)
      .values({ userId: user.id, tokenHash: "default-check", familyId: FAMILY, expiresAt: soon() })
      .returning();

    expect(row.issuedAt).toBeInstanceOf(Date);
  });
});

describe("C2C-SEC-2 AC2 — indexes", () => {
  async function indexedColumns(): Promise<{ definition: string }[]> {
    const { rows } = await pool.query(
      `SELECT indexdef AS definition FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'refresh_tokens'`,
    );
    return rows;
  }

  it("indexes token_hash uniquely — the lookup on every refresh", async () => {
    const defs = await indexedColumns();
    expect(
      defs.some((d) => /UNIQUE/i.test(d.definition) && /\(token_hash\)/.test(d.definition)),
      `no unique index on token_hash among: ${defs.map((d) => d.definition).join(" | ")}`,
    ).toBe(true);
  });

  it("indexes user_id and family_id — revoking a family must not scan the table", async () => {
    const defs = await indexedColumns();
    for (const col of ["user_id", "family_id"]) {
      expect(
        defs.some((d) => new RegExp(`\\(${col}\\)`).test(d.definition)),
        `no index on ${col}`,
      ).toBe(true);
    }
  });
});

describe("C2C-SEC-2 — constraints and cascade", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("AC3: deleting a user deletes their refresh tokens", async () => {
    const user = await makeUser();
    const db = await getTestDb();

    await db.insert(refreshTokens).values([
      { userId: user.id, tokenHash: "cascade-a", familyId: FAMILY, expiresAt: soon() },
      { userId: user.id, tokenHash: "cascade-b", familyId: FAMILY, expiresAt: soon() },
    ]);

    await db.delete(users).where(sql`${users.id} = ${user.id}`);

    expect(await db.select().from(refreshTokens)).toHaveLength(0);
  });

  it("AC4: a duplicate token_hash is rejected", async () => {
    const user = await makeUser();
    const db = await getTestDb();

    await db
      .insert(refreshTokens)
      .values({ userId: user.id, tokenHash: "duplicate", familyId: FAMILY, expiresAt: soon() });

    await expect(
      db
        .insert(refreshTokens)
        .values({ userId: user.id, tokenHash: "duplicate", familyId: FAMILY, expiresAt: soon() }),
    ).rejects.toThrow();
  });

  it("replaced_by_id points at another refresh token, so the chain is auditable", async () => {
    const user = await makeUser();
    const db = await getTestDb();

    const [first] = await db
      .insert(refreshTokens)
      .values({ userId: user.id, tokenHash: "chain-1", familyId: FAMILY, expiresAt: soon() })
      .returning();

    const [second] = await db
      .insert(refreshTokens)
      .values({
        userId: user.id,
        tokenHash: "chain-2",
        familyId: FAMILY,
        expiresAt: soon(),
      })
      .returning();

    await db
      .update(refreshTokens)
      .set({ replacedById: second.id })
      .where(sql`${refreshTokens.id} = ${first.id}`);

    const [reloaded] = await db
      .select()
      .from(refreshTokens)
      .where(sql`${refreshTokens.id} = ${first.id}`);

    expect(reloaded.replacedById).toBe(second.id);
  });

  it("rejects a replaced_by_id that references no row", async () => {
    const user = await makeUser();
    const db = await getTestDb();

    await expect(
      db.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: "dangling",
        familyId: FAMILY,
        expiresAt: soon(),
        replacedById: 999_999,
      }),
    ).rejects.toThrow();
  });
});

describe("C2C-SEC-2 AC5 — the Drizzle relation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("db.query.refreshTokens returns the joined user", async () => {
    const user = await makeUser({ email: "relation@example.test" });
    const db = await getTestDb();

    await db
      .insert(refreshTokens)
      .values({ userId: user.id, tokenHash: "relation", familyId: FAMILY, expiresAt: soon() });

    const row = await db.query.refreshTokens.findFirst({ with: { user: true } });

    // Typed access, not a cast: if the relation were missing this would not compile.
    expect(row?.user.email).toBe("relation@example.test");
  });

  it("a user's tokens are reachable from the user side", async () => {
    const user = await makeUser();
    const db = await getTestDb();

    await db.insert(refreshTokens).values([
      { userId: user.id, tokenHash: "many-1", familyId: FAMILY, expiresAt: soon() },
      { userId: user.id, tokenHash: "many-2", familyId: FAMILY, expiresAt: soon() },
    ]);

    const row = await db.query.users.findFirst({ with: { refreshTokens: true } });

    expect(row?.refreshTokens).toHaveLength(2);
  });
});

describe("C2C-SEC-2 AC6 — pruning expired tokens", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it("deletes only rows more than 30 days past expiry", async () => {
    const { pruneRefreshTokens } = await import("./prune-tokens");
    const user = await makeUser();
    const db = await getTestDb();

    await db.insert(refreshTokens).values([
      { userId: user.id, tokenHash: "live", familyId: FAMILY, expiresAt: soon() },
      { userId: user.id, tokenHash: "expired-recently", familyId: FAMILY, expiresAt: daysAgo(2) },
      { userId: user.id, tokenHash: "expired-29d", familyId: FAMILY, expiresAt: daysAgo(29) },
      { userId: user.id, tokenHash: "expired-31d", familyId: FAMILY, expiresAt: daysAgo(31) },
      { userId: user.id, tokenHash: "expired-90d", familyId: FAMILY, expiresAt: daysAgo(90) },
    ]);

    const deleted = await pruneRefreshTokens();

    expect(deleted).toBe(2);
    const remaining = (await db.select().from(refreshTokens)).map((r) => r.tokenHash).sort();
    expect(remaining).toEqual(["expired-29d", "expired-recently", "live"]);
  });

  it("returns 0 and deletes nothing when every token is inside the window", async () => {
    const { pruneRefreshTokens } = await import("./prune-tokens");
    const user = await makeUser();
    const db = await getTestDb();

    await db
      .insert(refreshTokens)
      .values({ userId: user.id, tokenHash: "live", familyId: FAMILY, expiresAt: soon() });

    expect(await pruneRefreshTokens()).toBe(0);
    expect(await db.select().from(refreshTokens)).toHaveLength(1);
  });

  it("prunes a revoked token too, once it is far enough past expiry", async () => {
    // Revocation does not delete: reuse detection needs the row to stay readable while
    // the token could still plausibly be presented.
    const { pruneRefreshTokens } = await import("./prune-tokens");
    const user = await makeUser();
    const db = await getTestDb();

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: "revoked-old",
      familyId: FAMILY,
      expiresAt: daysAgo(45),
      revokedAt: daysAgo(46),
    });

    expect(await pruneRefreshTokens()).toBe(1);
  });

  it("is exposed as `npm run db:prune-tokens`", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts["db:prune-tokens"]).toBeDefined();
  });
});
