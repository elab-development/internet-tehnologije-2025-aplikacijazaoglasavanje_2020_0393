/**
 * C2C-SEC-8 spec — linking and unlinking external identities.
 *
 * The rule this story exists to enforce (decision D9): an OAuth email colliding with an
 * existing password account is **never** linked automatically. If a provider hands over
 * an unverified `victim@example.com`, auto-linking gives the attacker the victim's
 * account outright. So a collision stops the sign-in, and the real owner has to prove
 * ownership with their existing password before the identity is attached.
 *
 * The second rule is the mirror image: a user must never be able to remove their last
 * credential and lock themselves out.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { oauthAccounts, users } from "@/db/schema";
import { AUTH_COOKIE } from "@/lib/cookies";
import { LINK_COOKIE, openLinkToken, sealLinkToken } from "@/lib/oauth/link-token";
import { REFRESH_COOKIE } from "@/lib/refresh-cookies";
import { LINK_RATE_LIMIT, resetRateLimits } from "@/lib/rate-limit";
import { OAUTH_TX_COOKIE, sealTransaction } from "@/lib/oauth/state";
import { getTestDb, resetDb } from "@/test/db";
import { authHeaderFor } from "@/test/auth";
import { makeOAuthAccount, makeUser } from "@/test/factories";

let clientCounter = 0;
const nextIp = () => `10.4.0.${(clientCounter += 1) % 250}`;

let originalEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  originalEnv = { ...process.env };
  process.env.OAUTH_PROVIDER = "mock";
  process.env.OAUTH_REDIRECT_BASE_URL = "http://localhost:3000";
  await resetDb();
  resetRateLimits();
});

afterEach(() => {
  process.env = originalEnv;
});

const PASSWORD = "password123";
const MOCK_EMAIL = "ada@mock-oauth.test";

function setCookies(r: Response): string[] {
  return r.headers.getSetCookie?.() ?? [];
}
function cookie(r: Response, name: string): string | undefined {
  return setCookies(r).find((c) => c.startsWith(`${name}=`));
}
function cookieValue(r: Response, name: string): string {
  const found = cookie(r, name);
  if (!found) throw new Error(`no ${name} cookie`);
  return found.slice(name.length + 1).split(";")[0];
}
const location = (r: Response) => r.headers.get("location") ?? "";

/** Drives the OAuth callback for the mock "ada" identity. */
async function callback(code = "ada") {
  const { GET } = await import("./[provider]/callback/route");
  const tx = sealTransaction({
    provider: "google",
    state: "s",
    codeVerifier: "v",
  });

  return GET(
    new NextRequest(
      `http://localhost/api/auth/oauth/google/callback?code=${code}&state=s`,
      { headers: { cookie: `${OAUTH_TX_COOKIE}=${tx}`, "x-forwarded-for": nextIp() } },
    ),
    { params: Promise.resolve({ provider: "google" }) },
  );
}

/** POST /api/auth/oauth/link */
async function link(body: unknown, linkCookie?: string) {
  const { POST } = await import("./link/route");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": nextIp(),
  };
  if (linkCookie) headers.cookie = `${LINK_COOKIE}=${linkCookie}`;

  return POST(
    new NextRequest("http://localhost/api/auth/oauth/link", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

/** DELETE /api/auth/oauth/link/[provider] */
async function unlink(provider: string, headers: Record<string, string>) {
  const { DELETE } = await import("./link/[provider]/route");
  return DELETE(
    new NextRequest(`http://localhost/api/auth/oauth/link/${provider}`, {
      method: "DELETE",
      headers: { ...headers, "x-forwarded-for": nextIp() },
    }),
    { params: Promise.resolve({ provider }) },
  );
}

async function me(headers: Record<string, string>) {
  const { GET } = await import("../me/route");
  return GET(new NextRequest("http://localhost/api/auth/me", { headers }));
}

describe("C2C-SEC-8 AC1 — a verified collision goes to the link screen", () => {
  it("redirects to /link-account and does not sign the user in", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });

    const response = await callback();

    expect(location(response)).toContain("/link-account");
    expect(cookie(response, REFRESH_COOKIE)).toBeUndefined();
    expect(cookie(response, AUTH_COOKIE)).toBeUndefined();
  });

  it("hands over a link token in an httpOnly cookie, not in the URL", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });

    const response = await callback();

    expect(cookie(response, LINK_COOKIE)).toMatch(/HttpOnly/i);
    // A token in the query string lands in history and the Referer header.
    expect(location(response)).not.toMatch(/token=/i);
  });

  it("creates no link and no second user while it waits", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });

    await callback();

    const db = await getTestDb();
    expect(await db.select().from(oauthAccounts)).toHaveLength(0);
    expect(await db.select().from(users)).toHaveLength(1);
  });
});

describe("Task 5 — the collision match is case-insensitive", () => {
  it("finds the existing account regardless of the provider's casing, and creates no second row", async () => {
    // The column is lowercased (migration 0019); a provider returning a different casing
    // for the same address must still resolve to this row. Before the callback's
    // `findOrCreateOAuthUser` normalised `profile.email`, an exact-match
    // `eq(users.email, …)` here would miss it and fall through to creating a brand-new
    // account under the differently-cased address -- the second-account bug this task
    // closes, reached through the collision path instead of plain registration.
    const existing = await makeUser({ email: MOCK_EMAIL, password: PASSWORD });

    // The mock provider derives the profile email from the code verbatim, so a
    // differently-cased code stands in for a provider that hands back "ADA@mock-oauth.test"
    // while the account on file is "ada@mock-oauth.test".
    const response = await callback("ADA");

    expect(location(response)).toContain("/link-account");

    const linkCookie = cookieValue(response, LINK_COOKIE);
    const token = openLinkToken(linkCookie);
    // The collision offered is against *this* existing user, not a lookup miss that
    // silently seeded a new one.
    expect(token?.userId).toBe(existing.id);

    const db = await getTestDb();
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(oauthAccounts)).toHaveLength(0);
  });
});

describe("C2C-SEC-8 AC2 — completing the link with the right password", () => {
  it("creates the identity, signs the user in, and adds no duplicate account", async () => {
    const existing = await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);

    const response = await link({ password: PASSWORD }, linkCookie);

    expect(response.status).toBe(200);
    expect(cookie(response, REFRESH_COOKIE)).toBeDefined();

    const db = await getTestDb();
    const links = await db.select().from(oauthAccounts);
    expect(links).toHaveLength(1);
    expect(links[0].userId).toBe(existing.id);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("clears the link cookie once it has been spent", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);

    const response = await link({ password: PASSWORD }, linkCookie);

    expect(cookie(response, LINK_COOKIE)).toMatch(/Max-Age=0/i);
  });
});

describe("C2C-SEC-8 AC3 — the wrong password", () => {
  it("fails generically and creates no link", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);

    const response = await link({ password: "not-the-password" }, linkCookie);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    // Same wording as login: this endpoint must not become a password oracle.
    expect(body.error).toBe("Invalid email or password");

    expect(await (await getTestDb()).select().from(oauthAccounts)).toHaveLength(0);
  });

  it("is rate limited, so the link screen is not a brute-force surface", async () => {
    // One hop: the header below is a single address, the shape a trusted proxy
    // produces. Without a trusted proxy the address is unknowable and the IP limit is
    // skipped by design (rateLimitByIp), so this test must simulate having one.
    process.env.TRUSTED_PROXY_HOPS = "1";

    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);

    // Same IP throughout: the limiter must bite.
    const { POST } = await import("./link/route");
    const attempt = () =>
      POST(
        new NextRequest("http://localhost/api/auth/oauth/link", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${LINK_COOKIE}=${linkCookie}`,
            "x-forwarded-for": "198.51.100.7",
          },
          body: JSON.stringify({ password: "wrong" }),
        }),
      );

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await attempt()).status);

    expect(statuses).toContain(429);
  });
});

/**
 * The IP key above is the whole guard only when a proxy is trusted. `TRUSTED_PROXY_HOPS`
 * defaults to 0, and at 0 `rateLimitByIp` reports `applied: false` and the guard does not
 * run at all -- so the route's own claim to be treated "like login" was, under the
 * shipped default, untrue. An account key keyed on the signed token's `userId` is what
 * makes it true, and it inherits login's property along with its shape.
 */
describe("the link limit under the default TRUSTED_PROXY_HOPS=0", () => {
  it("still bounds guessing when the caller's address is unknowable", async () => {
    process.env.TRUSTED_PROXY_HOPS = "0";

    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);

    const statuses: number[] = [];
    for (let i = 0; i < LINK_RATE_LIMIT.limit + 1; i += 1) {
      statuses.push((await link({ password: `guess-${i}` }, linkCookie)).status);
    }

    // `link` rotates the address on every call, so nothing but the account key can bite.
    expect(statuses).toContain(429);
  });

  it("does not let a guesser refuse the account's owner their own link", async () => {
    process.env.TRUSTED_PROXY_HOPS = "0";

    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);

    for (let i = 0; i < LINK_RATE_LIMIT.limit + 2; i += 1) {
      await link({ password: `guess-${i}` }, linkCookie);
    }

    // The bucket is spent, and the right password still completes the link -- the same
    // property login carries, for the same reason: the credentials decide first.
    expect((await link({ password: PASSWORD }, linkCookie)).status).toBe(200);
  });
});

describe("C2C-SEC-8 AC4 — an unverified provider email", () => {
  it("never links, never logs in, and says why", async () => {
    await makeUser({ email: "unverified@mock-oauth.test", password: PASSWORD });

    // The mock marks this identity's address unverified.
    const response = await callback("__unverified__");

    expect(location(response)).toContain("error=email_unverified");
    expect(cookie(response, REFRESH_COOKIE)).toBeUndefined();
    expect(cookie(response, LINK_COOKIE)).toBeUndefined();
    expect(await (await getTestDb()).select().from(oauthAccounts)).toHaveLength(0);
  });
});

describe("C2C-SEC-8 AC5 — the link token", () => {
  it("is rejected once it has already been used", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);

    expect((await link({ password: PASSWORD }, linkCookie)).status).toBe(200);

    // Replaying the same token must not link a second time or re-issue a session.
    const replay = await link({ password: PASSWORD }, linkCookie);
    expect(replay.status).toBe(409);
    expect(await (await getTestDb()).select().from(oauthAccounts)).toHaveLength(1);
  });

  it("is rejected past ten minutes", async () => {
    const user = await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const stale = sealLinkToken(
      {
        userId: user.id,
        provider: "google",
        providerAccountId: "abc",
        providerEmail: MOCK_EMAIL,
      },
      { issuedAt: Date.now() - 11 * 60 * 1000 },
    );

    expect((await link({ password: PASSWORD }, stale)).status).toBe(401);
  });

  it("is rejected when tampered with", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);

    const [body, signature] = linkCookie.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    decoded.userId = 9999;
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

    expect((await link({ password: PASSWORD }, forged)).status).toBe(401);
  });

  it("is required — no cookie, no link", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });

    expect((await link({ password: PASSWORD })).status).toBe(401);
  });
});

describe("C2C-SEC-8 AC6/AC7/AC8 — unlinking", () => {
  it("AC6: a user with a password and one provider may unlink it", async () => {
    const user = await makeUser({ password: PASSWORD });
    await makeOAuthAccount({ userId: user.id, provider: "google" });

    const response = await unlink("google", authHeaderFor(user));

    expect(response.status).toBe(200);
    expect(await (await getTestDb()).select().from(oauthAccounts)).toHaveLength(0);
  });

  it("AC7: an OAuth-only user with one provider may not unlink it", async () => {
    const user = await makeUser({ password: null });
    await makeOAuthAccount({ userId: user.id, provider: "google" });

    const response = await unlink("google", authHeaderFor(user));

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    // The message has to be actionable, not just a refusal.
    expect(body.error).toMatch(/password/i);
    expect(await (await getTestDb()).select().from(oauthAccounts)).toHaveLength(1);
  });

  it("AC8: an OAuth-only user with two providers may unlink one", async () => {
    const user = await makeUser({ password: null });
    await makeOAuthAccount({ userId: user.id, provider: "google" });
    await makeOAuthAccount({ userId: user.id, provider: "github" });

    const response = await unlink("google", authHeaderFor(user));

    expect(response.status).toBe(200);
    const remaining = await (await getTestDb()).select().from(oauthAccounts);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].provider).toBe("github");
  });

  it("cannot unlink another user's identity", async () => {
    const victim = await makeUser({ password: PASSWORD });
    await makeOAuthAccount({ userId: victim.id, provider: "google" });
    const attacker = await makeUser({ password: PASSWORD });

    const response = await unlink("google", authHeaderFor(attacker));

    expect(response.status).toBe(404);
    expect(await (await getTestDb()).select().from(oauthAccounts)).toHaveLength(1);
  });

  it("requires authentication", async () => {
    const user = await makeUser({ password: PASSWORD });
    await makeOAuthAccount({ userId: user.id, provider: "google" });

    expect((await unlink("google", {})).status).toBe(401);
  });

  it("answers 404 for a provider that is not linked", async () => {
    const user = await makeUser({ password: PASSWORD });

    expect((await unlink("google", authHeaderFor(user))).status).toBe(404);
  });
});

describe("C2C-SEC-8 AC9 — GET /api/auth/me", () => {
  it("reports the linked providers", async () => {
    const user = await makeUser({ password: PASSWORD });
    await makeOAuthAccount({ userId: user.id, provider: "google" });

    const body = (await (await me(authHeaderFor(user))).json()) as {
      user: { linkedProviders?: string[]; passwordHash?: string };
    };

    expect(body.user.linkedProviders).toEqual(["google"]);
  });

  it("reports an empty list rather than omitting the field", async () => {
    const user = await makeUser({ password: PASSWORD });

    const body = (await (await me(authHeaderFor(user))).json()) as {
      user: { linkedProviders?: string[] };
    };

    // A missing field and "none linked" must not look the same to the UI.
    expect(body.user.linkedProviders).toEqual([]);
  });

  it("never includes the password hash", async () => {
    const user = await makeUser({ password: PASSWORD });
    await makeOAuthAccount({ userId: user.id, provider: "google" });

    const raw = await (await me(authHeaderFor(user))).text();

    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("password_hash");
  });

  it("reports whether the account has a password, so the UI can explain a blocked unlink", async () => {
    const withPassword = await makeUser({ password: PASSWORD });
    const without = await makeUser({ password: null });

    const a = (await (await me(authHeaderFor(withPassword))).json()) as {
      user: { hasPassword?: boolean };
    };
    const b = (await (await me(authHeaderFor(without))).json()) as {
      user: { hasPassword?: boolean };
    };

    expect(a.user.hasPassword).toBe(true);
    expect(b.user.hasPassword).toBe(false);
  });
});

describe("C2C-SEC-8 — the linked identity works for signing in afterwards", () => {
  it("a second OAuth sign-in goes straight through", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);
    await link({ password: PASSWORD }, linkCookie);

    const second = await callback();

    expect(location(second)).not.toContain("link-account");
    expect(cookie(second, REFRESH_COOKIE)).toBeDefined();

    const db = await getTestDb();
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(oauthAccounts)).toHaveLength(1);
  });

  it("the password still works too", async () => {
    await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);
    await link({ password: PASSWORD }, linkCookie);

    const { POST } = await import("../login/route");
    const response = await POST(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
        body: JSON.stringify({ email: MOCK_EMAIL, password: PASSWORD }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("does not blow up when the same provider account is linked twice", async () => {
    const user = await makeUser({ email: MOCK_EMAIL, password: PASSWORD });
    await makeOAuthAccount({
      userId: user.id,
      provider: "google",
      providerAccountId: "already-there",
    });

    // A different identity at the same provider is a separate row; the composite
    // unique constraint is on (provider, provider_account_id), not on user+provider.
    const linkCookie = cookieValue(await callback(), LINK_COOKIE);
    const response = await link({ password: PASSWORD }, linkCookie);

    expect([200, 409]).toContain(response.status);
    const db = await getTestDb();
    const rows = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, user.id));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
