// ─── Refresh tokens ───────────────────────────────────────────────────────────
// Issuance, single-use rotation, and reuse detection (C2C-SEC-3).
//
// The security argument, in one paragraph: a refresh token is single-use. Rotating it
// mints a successor and revokes the presented token. So if a token that has *already*
// been rotated is presented again, either the client is buggy or the token was stolen
// and someone is racing the legitimate holder. You cannot tell which from the request,
// so you assume theft and revoke the entire family, forcing a fresh login. That costs a
// buggy client one re-login and costs an attacker the whole session.

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db, type Database } from "@/db";
import { refreshTokens } from "@/db/schema";

/** Token entropy. 32 bytes of CSPRNG output is not guessable and not worth stretching. */
export const REFRESH_TOKEN_BYTES = 32;

/** How long a refresh token stays usable. Must track REFRESH_COOKIE_MAX_AGE. */
export const REFRESH_TOKEN_TTL_DAYS = 30;

export type RefreshTokenFailure =
  | "not_found"
  | "expired"
  | "revoked"
  | "reused"
  /** Lost a race with a simultaneous rotation. Not theft — see rotateRefreshToken. */
  | "concurrent";

export class RefreshTokenError extends Error {
  constructor(
    message: string,
    public readonly reason: RefreshTokenFailure,
  ) {
    super(message);
    this.name = "RefreshTokenError";
  }
}

/** Where a token was issued or presented from. Best effort — both may be absent. */
export type RefreshTokenContext = {
  userAgent?: string | null;
  ip?: string | null;
};

/**
 * Either the pool-backed client or a transaction handle, following `OrderExecutor`
 * (`src/db/orders.ts`). `revokeAllRefreshFamiliesForUser` has to be callable inside the
 * caller's own transaction — a password change writing the new hash and revoking the
 * old sessions is one atomic act, and committing them separately would let a crash
 * between the two leave the new hash live and the attacker's session live alongside it.
 */
export type RefreshExecutor =
  | Omit<Database, "$client">
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type IssuedRefreshToken = {
  /** The raw token. Returned once, to be set as a cookie; never stored. */
  token: string;
  userId: number;
  familyId: string;
  expiresAt: Date;
};

/**
 * SHA-256, hex.
 *
 * Not bcrypt: bcrypt's cost exists to slow brute force against low-entropy secrets, and
 * this is 32 random bytes — there is nothing to brute force. Refresh also sits on a hot
 * path where a deliberately slow hash is a real latency cost for no security gain.
 */
export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function expiryFromNow(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Starts a new token family. One login, one family. */
export async function issueRefreshToken(
  userId: number,
  ctx: RefreshTokenContext = {},
): Promise<IssuedRefreshToken> {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
  const familyId = randomUUID();
  const expiresAt = expiryFromNow();

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashRefreshToken(token),
    familyId,
    expiresAt,
    userAgent: ctx.userAgent ?? null,
    ip: ctx.ip ?? null,
  });

  return { token, userId, familyId, expiresAt };
}

/**
 * Exchanges a live token for its successor.
 *
 * Two phases, and the split is deliberate. Reuse detection runs first and *outside* a
 * transaction, because burning the family has to outlive the error thrown alongside it.
 * The exchange then runs inside one, claiming the presented row with a conditional
 * UPDATE (`WHERE revoked_at IS NULL`) rather than a read-then-write. That is what makes
 * AC10 hold: two concurrent refreshes both read an unrevoked row, but only one
 * `UPDATE ... RETURNING` matches, so only one mints a successor. A SELECT followed by an
 * unconditional UPDATE would let both through.
 *
 * @throws RefreshTokenError on every failure, with a `reason` the caller can branch on.
 */
export async function rotateRefreshToken(
  rawToken: string,
  ctx: RefreshTokenContext = {},
): Promise<IssuedRefreshToken> {
  const presentedHash = hashRefreshToken(rawToken);

  // ── Reuse detection ───────────────────────────────────────────────────────
  // Deliberately *outside* the transaction below. Burning the family is a side effect
  // that must survive the failure it accompanies, and a revocation written inside a
  // transaction that then throws is rolled straight back — the family would look
  // revoked to the code that wrote it and be perfectly live to everyone else.
  const [presented] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, presentedHash))
    .limit(1);

  if (!presented) {
    throw new RefreshTokenError("Refresh token not recognised", "not_found");
  }

  // Already revoked means it has been rotated before, or its family was burned.
  // Either way it must never work again, and the family is no longer trustworthy.
  if (presented.revokedAt !== null) {
    await revokeRefreshTokenFamily(presented.familyId);

    // Logged, not swallowed: this is the signal that a token was stolen. The raw token
    // is deliberately absent from the message — logs are not a secret store.
    console.warn(
      `[refresh-token] reuse detected: user=${presented.userId} family=${presented.familyId} — revoking family`,
    );

    throw new RefreshTokenError("Refresh token has already been used", "reused");
  }

  if (presented.expiresAt.getTime() <= Date.now()) {
    throw new RefreshTokenError("Refresh token has expired", "expired");
  }

  return db.transaction(async (tx) => {
    const existing = presented;

    // ── Claim it ────────────────────────────────────────────────────────────
    // Conditional on still being unrevoked, so a concurrent rotation cannot also win.
    const claimed = await tx
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(eq(refreshTokens.id, existing.id), isNull(refreshTokens.revokedAt)),
      )
      .returning({ id: refreshTokens.id });

    if (claimed.length === 0) {
      // Lost a race with a rotation that started after our reuse check. This is not
      // treated as theft: two tabs refreshing at once is ordinary, and burning the
      // family would sign an honest user out for using the app normally. The loser
      // simply fails and retries with whatever cookie it now holds.
      throw new RefreshTokenError(
        "Refresh token was rotated concurrently",
        "concurrent",
      );
    }

    const token = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
    const expiresAt = expiryFromNow();

    const [successor] = await tx
      .insert(refreshTokens)
      .values({
        userId: existing.userId,
        tokenHash: hashRefreshToken(token),
        familyId: existing.familyId,
        expiresAt,
        userAgent: ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
      })
      .returning({ id: refreshTokens.id });

    await tx
      .update(refreshTokens)
      .set({ replacedById: successor.id })
      .where(eq(refreshTokens.id, existing.id));

    return { token, userId: existing.userId, familyId: existing.familyId, expiresAt };
  });
}

/**
 * Revokes one token.
 *
 * A no-op for an unknown token: logout should not fail because the browser held a stale
 * cookie, and reporting "that token does not exist" would be an oracle.
 */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(refreshTokens.tokenHash, hashRefreshToken(rawToken)),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

/**
 * Revokes every live token in a family.
 *
 * The primitive behind both logout and reuse detection — and behind the deferred
 * "sign out other devices" screen.
 *
 * @returns how many tokens were newly revoked.
 */
export async function revokeRefreshTokenFamily(familyId: string): Promise<number> {
  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)),
    )
    .returning({ id: refreshTokens.id });

  return revoked.length;
}

/**
 * Revokes every live refresh token a user holds, across all families.
 *
 * `revokeRefreshTokenFamily` handles one family, which is right for reuse detection --
 * that is a statement about one lineage. A password change is a statement about the whole
 * account, so it takes all of them.
 */
export async function revokeAllRefreshFamiliesForUser(
  x: RefreshExecutor,
  userId: number,
): Promise<number> {
  const revoked = await x
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });

  return revoked.length;
}

/** The family a raw token belongs to, or null if it is unknown. */
export async function familyOf(rawToken: string): Promise<string | null> {
  const [row] = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(rawToken)))
    .limit(1);

  return row?.familyId ?? null;
}
