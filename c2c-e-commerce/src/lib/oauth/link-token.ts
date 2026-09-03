// ─── Link token ───────────────────────────────────────────────────────────────
// The challenge handed to someone whose OAuth email collides with an existing password
// account (C2C-SEC-8, decision D9).
//
// It proves only *which* link was proposed and *when*. It confers nothing on its own:
// the holder still has to produce the account's existing password. That is deliberate —
// the token travels through a browser redirect, and anything it could authorise by
// itself would be an account-takeover primitive.

import { createHmac, timingSafeEqual } from "node:crypto";

import type { ProviderName } from "./types";

export const LINK_COOKIE = "link_tx";

/** Ten minutes, matching the OAuth transaction it descends from. */
export const LINK_TOKEN_MAX_AGE = 600;

export type LinkToken = {
  /** The existing account the identity would attach to. */
  userId: number;
  provider: ProviderName;
  providerAccountId: string;
  providerEmail: string;
};

type SealedLinkToken = LinkToken & { iat: number };

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET environment variable is not set");
  return value;
}

function sign(body: string): string {
  // Domain-separated from the oauth_tx signature: the two payloads are different
  // shapes with different authority, and one must never verify as the other.
  return createHmac("sha256", secret()).update(`link:${body}`).digest("base64url");
}

export function sealLinkToken(
  token: LinkToken,
  options: { issuedAt?: number } = {},
): string {
  const payload: SealedLinkToken = { ...token, iat: options.issuedAt ?? Date.now() };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return `${body}.${sign(body)}`;
}

/** Verifies and decodes, or null for tampered, malformed, or expired. */
export function openLinkToken(raw: string): LinkToken | null {
  const parts = raw.split(".");
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const provided = Buffer.from(signature);

  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SealedLinkToken;

    if (typeof payload.iat !== "number") return null;
    if (Date.now() - payload.iat > LINK_TOKEN_MAX_AGE * 1000) return null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { iat: _iat, ...token } = payload;
    return token;
  } catch {
    return null;
  }
}

export type LinkCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

export function linkCookieOptions(): LinkCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: LINK_TOKEN_MAX_AGE,
  };
}

export function clearedLinkCookieOptions(): LinkCookieOptions {
  return { ...linkCookieOptions(), maxAge: 0 };
}
