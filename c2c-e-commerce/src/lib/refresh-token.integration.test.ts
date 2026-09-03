/**
 * C2C-SEC-3 spec — issuance, rotation, and reuse detection.
 *
 * AC6 (replay revokes the family) and AC10 (concurrent rotation) are the two the whole
 * design exists for, so they are named tests rather than assertions buried in a larger
 * case, per the story's test notes.
 *
 * These run against a real database because rotation is a transaction: the invariant
 * "exactly one of two concurrent refreshes succeeds" is a property of Postgres's
 * concurrency control, and a mocked store would assert nothing about it.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { refreshTokens, type User } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeUser } from "@/test/factories";

import {
  REFRESH_TOKEN_BYTES,
  REFRESH_TOKEN_TTL_DAYS,
  RefreshTokenError,
  hashRefreshToken,
  issueRefreshToken,
  revokeRefreshToken,
  revokeRefreshTokenFamily,
  rotateRefreshToken,
} from "./refresh-token";

let user: User;

beforeEach(async () => {
  await resetDb();
  user = await makeUser();
});

/** Every row currently stored, oldest first. */
async function allRows() {
  const db = await getTestDb();
  return db.select().from(refreshTokens).orderBy(refreshTokens.id);
}

async function rowFor(raw: string) {
  const db = await getTestDb();
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(raw)));
  return row;
}

describe("C2C-SEC-3 — issuing", () => {
  it("returns a high-entropy token and stores only its hash", async () => {
    const { token } = await issueRefreshToken(user.id);

    // base64url of 32 bytes: 43 characters, no padding, URL-safe alphabet.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(REFRESH_TOKEN_BYTES).toBe(32);
  });

  it("AC9: the raw token appears nowhere in the database", async () => {
    const { token } = await issueRefreshToken(user.id);

    const rows = await allRows();
    const serialised = JSON.stringify(rows);

    expect(serialised).not.toContain(token);
    expect(rows[0].tokenHash).toBe(hashRefreshToken(token));
    // SHA-256 hex.
    expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("issues two different tokens for two calls", async () => {
    const a = await issueRefreshToken(user.id);
    const b = await issueRefreshToken(user.id);

    expect(a.token).not.toBe(b.token);
    // Separate logins are separate families: revoking one must not sign the other out.
    expect(a.familyId).not.toBe(b.familyId);
  });

  it("expires the token 30 days out", async () => {
    const { expiresAt } = await issueRefreshToken(user.id);

    const days = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("records the provenance it is given", async () => {
    const { token } = await issueRefreshToken(user.id, {
      userAgent: "Mozilla/5.0 (test)",
      ip: "203.0.113.7",
    });

    const row = await rowFor(token);
    expect(row.userAgent).toBe("Mozilla/5.0 (test)");
    expect(row.ip).toBe("203.0.113.7");
  });
});

describe("C2C-SEC-3 — rotation", () => {
  it("AC3: rotating issues a different token and revokes the old one", async () => {
    const first = await issueRefreshToken(user.id);

    const second = await rotateRefreshToken(first.token);

    expect(second.token).not.toBe(first.token);

    const old = await rowFor(first.token);
    expect(old.revokedAt).toBeInstanceOf(Date);

    const fresh = await rowFor(second.token);
    expect(fresh.revokedAt).toBeNull();
  });

  it("keeps the successor in the same family", async () => {
    const first = await issueRefreshToken(user.id);
    const second = await rotateRefreshToken(first.token);

    expect(second.familyId).toBe(first.familyId);
  });

  it("AC11: replaced_by_id points at the successor, so the chain is auditable", async () => {
    const first = await issueRefreshToken(user.id);
    const second = await rotateRefreshToken(first.token);
    await rotateRefreshToken(second.token);

    const [a, b, c] = await allRows();
    expect(a.replacedById).toBe(b.id);
    expect(b.replacedById).toBe(c.id);
    expect(c.replacedById).toBeNull();
  });

  it("carries the user through rotation", async () => {
    const first = await issueRefreshToken(user.id);
    const second = await rotateRefreshToken(first.token);

    expect(second.userId).toBe(user.id);
  });

  it("rejects a token that was never issued", async () => {
    await expect(rotateRefreshToken("not-a-real-token")).rejects.toMatchObject({
      reason: "not_found",
    });
  });

  it("AC7: rejects an expired token and does not rotate it", async () => {
    const { token } = await issueRefreshToken(user.id);
    const db = await getTestDb();
    await db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));

    await expect(rotateRefreshToken(token)).rejects.toMatchObject({ reason: "expired" });

    // Still exactly one row: no successor was minted.
    expect(await allRows()).toHaveLength(1);
  });

  it("rejects a token whose family was revoked", async () => {
    const { token, familyId } = await issueRefreshToken(user.id);
    await revokeRefreshTokenFamily(familyId);

    await expect(rotateRefreshToken(token)).rejects.toBeInstanceOf(RefreshTokenError);
  });
});

describe("C2C-SEC-3 AC6 — reuse detection", () => {
  it("replaying a rotated token revokes every token in its family", async () => {
    const first = await issueRefreshToken(user.id);
    const second = await rotateRefreshToken(first.token);
    const third = await rotateRefreshToken(second.token);

    // The attacker presents the stolen ancestor.
    await expect(rotateRefreshToken(first.token)).rejects.toMatchObject({
      reason: "reused",
    });

    const rows = await allRows();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.revokedAt, `token ${row.id} should be revoked`).toBeInstanceOf(Date);
    }

    // The legitimate holder is signed out too — that is the point, since we cannot
    // tell which party is the thief.
    await expect(rotateRefreshToken(third.token)).rejects.toBeInstanceOf(RefreshTokenError);
  });

  it("does not touch a different family belonging to the same user", async () => {
    const laptop = await issueRefreshToken(user.id);
    const phone = await issueRefreshToken(user.id);
    await rotateRefreshToken(laptop.token);

    await expect(rotateRefreshToken(laptop.token)).rejects.toMatchObject({
      reason: "reused",
    });

    // The phone's session survives: only the compromised chain is destroyed.
    await expect(rotateRefreshToken(phone.token)).resolves.toBeDefined();
  });

  it("logs the event with the user id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = await issueRefreshToken(user.id);
    await rotateRefreshToken(first.token);
    await rotateRefreshToken(first.token).catch(() => {});

    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain(String(user.id));
    // The token itself must not be written to logs.
    expect(logged).not.toContain(first.token);

    warn.mockRestore();
  });
});

describe("C2C-SEC-3 AC10 — concurrent rotation", () => {
  it("exactly one of two simultaneous refreshes succeeds", async () => {
    const { token } = await issueRefreshToken(user.id);

    const results = await Promise.allSettled([
      rotateRefreshToken(token),
      rotateRefreshToken(token),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("leaves the chain uncorrupted: one predecessor, one successor", async () => {
    const first = await issueRefreshToken(user.id);

    await Promise.allSettled([
      rotateRefreshToken(first.token),
      rotateRefreshToken(first.token),
    ]);

    const rows = await allRows();
    // The loser must not have minted a second successor.
    expect(rows).toHaveLength(2);
    expect(rows[0].replacedById).toBe(rows[1].id);
  });
});

describe("C2C-SEC-3 — revocation primitives", () => {
  it("revoke() marks a single token revoked", async () => {
    const { token } = await issueRefreshToken(user.id);

    await revokeRefreshToken(token);

    expect((await rowFor(token)).revokedAt).toBeInstanceOf(Date);
    await expect(rotateRefreshToken(token)).rejects.toBeInstanceOf(RefreshTokenError);
  });

  it("revoke() on an unknown token is a no-op, not an error", async () => {
    // Logout should not fail because the cookie held something stale.
    await expect(revokeRefreshToken("never-issued")).resolves.toBeUndefined();
  });

  it("revokeFamily() revokes the whole chain and reports how many", async () => {
    const first = await issueRefreshToken(user.id);
    const second = await rotateRefreshToken(first.token);
    await rotateRefreshToken(second.token);

    const revoked = await revokeRefreshTokenFamily(first.familyId);

    // The two already-rotated tokens were revoked by rotation; only the live one is
    // newly revoked.
    expect(revoked).toBe(1);
    for (const row of await allRows()) {
      expect(row.revokedAt).toBeInstanceOf(Date);
    }
  });

  it("revokeFamily() leaves other families alone", async () => {
    const laptop = await issueRefreshToken(user.id);
    const phone = await issueRefreshToken(user.id);

    await revokeRefreshTokenFamily(laptop.familyId);

    expect((await rowFor(phone.token)).revokedAt).toBeNull();
  });
});
