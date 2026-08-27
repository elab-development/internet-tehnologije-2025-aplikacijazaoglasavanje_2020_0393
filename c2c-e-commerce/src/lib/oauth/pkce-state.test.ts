/**
 * C2C-SEC-6 spec — PKCE and the OAuth transaction cookie.
 *
 * These are the two pieces that make a hand-rolled authorization-code flow safe:
 * `state` ties the callback to the browser that started it (CSRF), and PKCE ties the
 * code to the client that requested it (interception). Both live in a signed cookie for
 * the ten minutes the flow is in flight.
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  OAUTH_TX_COOKIE,
  OAUTH_TX_MAX_AGE,
  createCodeVerifier,
  deriveCodeChallenge,
  oauthTxCookieOptions,
  openTransaction,
  sealTransaction,
  type OAuthTransaction,
} from "./state";

const TX: OAuthTransaction = {
  provider: "google",
  state: "state-value",
  codeVerifier: "verifier-value",
  nonce: "nonce-value",
  returnTo: "/listings/5",
};

beforeEach(() => {
  process.env.JWT_SECRET ??= "c2c-test-secret";
});

describe("C2C-SEC-6 AC4 — PKCE", () => {
  it("derives the challenge as base64url(sha256(verifier))", () => {
    const verifier = createCodeVerifier();

    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(deriveCodeChallenge(verifier)).toBe(expected);
  });

  it("produces a verifier inside RFC 7636's 43-128 character range", () => {
    for (let i = 0; i < 20; i += 1) {
      const verifier = createCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    }
  });

  it("uses only unreserved characters, so no encoding step can alter it", () => {
    expect(createCodeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("AC3: a fresh verifier every call", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createCodeVerifier()));
    expect(seen.size).toBe(50);
  });

  it("the challenge is not the verifier — that would defeat the point", () => {
    const verifier = createCodeVerifier();
    expect(deriveCodeChallenge(verifier)).not.toBe(verifier);
  });
});

describe("C2C-SEC-6 AC9 — the oauth_tx cookie", () => {
  it("is HttpOnly, SameSite=Lax and expires in ten minutes", () => {
    const options = oauthTxCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.maxAge).toBe(600);
    expect(OAUTH_TX_MAX_AGE).toBe(600);
    expect(OAUTH_TX_COOKIE).toBe("oauth_tx");
  });

  it("round-trips a transaction unchanged", () => {
    expect(openTransaction(sealTransaction(TX))).toEqual(TX);
  });

  it("rejects a tampered payload", () => {
    const sealed = sealTransaction(TX);

    // Flip the state in the encoded body; the signature must no longer match.
    const [body, signature] = sealed.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    decoded.state = "attacker-chosen-state";
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

    expect(openTransaction(forged)).toBeNull();
  });

  it("rejects a truncated or malformed cookie without throwing", () => {
    for (const value of ["", "garbage", "a.b.c", "onlybody", "."]) {
      expect(() => openTransaction(value)).not.toThrow();
      expect(openTransaction(value)).toBeNull();
    }
  });

  it("rejects a transaction signed with a different secret", () => {
    const sealed = sealTransaction(TX);
    const original = process.env.JWT_SECRET;

    try {
      process.env.JWT_SECRET = "a-different-secret";
      expect(openTransaction(sealed)).toBeNull();
    } finally {
      process.env.JWT_SECRET = original;
    }
  });

  it("rejects a transaction past its ten-minute life", () => {
    const stale = sealTransaction(TX, {
      issuedAt: Date.now() - (OAUTH_TX_MAX_AGE + 1) * 1000,
    });

    // The cookie's own Max-Age is not enough: a client controls whether it sends one.
    expect(openTransaction(stale)).toBeNull();
  });

  it("accepts a transaction still inside its life", () => {
    const fresh = sealTransaction(TX, { issuedAt: Date.now() - 60 * 1000 });

    expect(openTransaction(fresh)).toEqual(TX);
  });

  it("carries returnTo through the flow", () => {
    const opened = openTransaction(sealTransaction({ ...TX, returnTo: "/orders/9" }));

    expect(opened?.returnTo).toBe("/orders/9");
  });

  it("does not put the verifier anywhere a page script can read it", () => {
    // The whole transaction lives in one httpOnly cookie; nothing is exposed to JS.
    expect(oauthTxCookieOptions().httpOnly).toBe(true);
  });
});
