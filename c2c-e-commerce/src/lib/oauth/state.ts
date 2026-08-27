// ─── OAuth transaction state ──────────────────────────────────────────────────
// The in-flight flow's memory: what `state` we issued, which PKCE verifier goes with
// it, and where to send the user afterwards (C2C-SEC-6).
//
// Held in a signed cookie rather than a database table. That keeps the flow stateless
// and avoids another migration; the trade-off is that an in-flight transaction cannot
// be revoked server-side, which is acceptable for something with a ten-minute life.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { ProviderName } from "./types";

export const OAUTH_TX_COOKIE = "oauth_tx";

/** Ten minutes. Long enough to sign in, short enough to be uninteresting to steal. */
export const OAUTH_TX_MAX_AGE = 600;

export type OAuthTransaction = {
  provider: ProviderName;
  state: string;
  codeVerifier?: string;
  nonce?: string;
  /** Where to land after login. Validated as a same-site path by the callback. */
  returnTo?: string;
};

type SealedPayload = OAuthTransaction & { iat: number };

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET environment variable is not set");
  return value;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

// ─── PKCE (RFC 7636) ──────────────────────────────────────────────────────────

/**
 * A fresh code verifier.
 *
 * 32 random bytes as base64url is 43 characters — the shortest the RFC allows, and
 * already 256 bits. The alphabet is a subset of the RFC's `unreserved` set, so no
 * encoding step anywhere can alter the value between here and the token endpoint.
 */
export function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** `base64url(sha256(verifier))` — the `S256` method. Plain is not offered. */
export function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** A fresh, opaque value for `state` or `nonce`. */
export function createOpaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

// ─── Sealing ──────────────────────────────────────────────────────────────────

/** Signs a transaction for storage in the cookie. */
export function sealTransaction(
  tx: OAuthTransaction,
  options: { issuedAt?: number } = {},
): string {
  const payload: SealedPayload = { ...tx, iat: options.issuedAt ?? Date.now() };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return `${body}.${sign(body)}`;
}

/**
 * Verifies and decodes a transaction cookie.
 *
 * Returns `null` for anything that is not a valid, unexpired transaction — tampered,
 * truncated, signed with another secret, or simply too old. The caller turns that into
 * one redirect; distinguishing the causes would only help someone probing.
 *
 * The expiry is checked here and not left to the cookie's `Max-Age`, because a client
 * decides whether to honour that. The signature is what makes `iat` trustworthy.
 */
export function openTransaction(raw: string): OAuthTransaction | null {
  const parts = raw.split(".");
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const provided = Buffer.from(signature);

  // Length check first: timingSafeEqual throws on a mismatch rather than returning false.
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SealedPayload;

    if (typeof payload.iat !== "number") return null;
    if (Date.now() - payload.iat > OAUTH_TX_MAX_AGE * 1000) return null;

    const { iat: _iat, ...tx } = payload;
    return tx;
  } catch {
    return null;
  }
}

export type OAuthTxCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

/**
 * `sameSite: "lax"` because the provider's callback is a top-level cross-site
 * navigation back into this app; `strict` would withhold the cookie on exactly the
 * request that needs it.
 */
export function oauthTxCookieOptions(): OAuthTxCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: OAUTH_TX_MAX_AGE,
  };
}

export function clearedOAuthTxCookieOptions(): OAuthTxCookieOptions {
  return { ...oauthTxCookieOptions(), maxAge: 0 };
}
