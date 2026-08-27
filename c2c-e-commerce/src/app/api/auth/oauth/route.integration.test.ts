/**
 * C2C-SEC-7 spec — the OAuth2 initiate and callback routes.
 *
 * Run against the mock provider (`OAUTH_PROVIDER=mock`), so the whole flow is exercised
 * without a network. The two real providers are covered by SEC-6's unit specs.
 *
 * The recurring theme in these assertions is **what must not happen**: no token in a
 * redirect URL, no user created on a failed `state` check, no role taken from the
 * provider, no external origin honoured in `returnTo`, no upstream error body echoed to
 * the browser. A callback that logs someone in correctly and also does one of those is
 * still broken.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { oauthAccounts, users } from "@/db/schema";
import { AUTH_COOKIE } from "@/lib/cookies";
import { REFRESH_COOKIE } from "@/lib/refresh-cookies";
import { resetRateLimits } from "@/lib/rate-limit";
import {
  OAUTH_TX_COOKIE,
  sealTransaction,
  type OAuthTransaction,
} from "@/lib/oauth/state";
import { getTestDb, resetDb } from "@/test/db";
import { makeOAuthAccount, makeUser } from "@/test/factories";

let clientCounter = 0;
const nextIp = () => `10.3.0.${(clientCounter += 1) % 250}`;

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

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie?.() ?? [];
}

function cookie(response: Response, name: string): string | undefined {
  return setCookies(response).find((c) => c.startsWith(`${name}=`));
}

function cookieValue(response: Response, name: string): string {
  const found = cookie(response, name);
  if (!found) throw new Error(`no ${name} cookie`);
  return found.slice(name.length + 1).split(";")[0];
}

/** GET /api/auth/oauth/[provider] */
async function initiate(provider: string, search = "") {
  const { GET } = await import("./[provider]/route");
  return GET(
    new NextRequest(`http://localhost/api/auth/oauth/${provider}${search}`, {
      headers: { "x-forwarded-for": nextIp() },
    }),
    { params: Promise.resolve({ provider }) },
  );
}

/** GET /api/auth/oauth/[provider]/callback */
async function callback(
  provider: string,
  search: string,
  txCookie?: string,
) {
  const { GET } = await import("./[provider]/callback/route");
  const headers: Record<string, string> = { "x-forwarded-for": nextIp() };
  if (txCookie) headers.cookie = `${OAUTH_TX_COOKIE}=${txCookie}`;

  return GET(
    new NextRequest(`http://localhost/api/auth/oauth/${provider}/callback${search}`, {
      headers,
    }),
    { params: Promise.resolve({ provider }) },
  );
}

/** A sealed transaction matching what an initiation would have stored. */
function tx(overrides: Partial<OAuthTransaction> = {}): string {
  return sealTransaction({
    provider: "google",
    state: "the-state",
    codeVerifier: "the-verifier",
    nonce: "the-nonce",
    ...overrides,
  });
}

const location = (response: Response) => response.headers.get("location") ?? "";

describe("C2C-SEC-7 AC1 — initiating", () => {
  it("redirects to the provider and sets the transaction cookie", async () => {
    const response = await initiate("google");

    expect(response.status).toBe(302);
    expect(location(response)).toContain("/google/authorize");
    expect(cookie(response, OAUTH_TX_COOKIE)).toBeDefined();
    expect(cookie(response, OAUTH_TX_COOKIE)).toMatch(/HttpOnly/i);
  });

  it("sends state and a PKCE challenge for a PKCE provider", async () => {
    const url = new URL(location(await initiate("google")));

    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("sends no challenge for GitHub, which cannot use one", async () => {
    const url = new URL(location(await initiate("github")));

    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeNull();
  });

  it("AC2: answers 404 for an unknown provider", async () => {
    const response = await initiate("facebook");

    expect(response.status).toBe(404);
  });

  it("AC2: answers 404 for a configured-but-absent provider", async () => {
    delete process.env.OAUTH_PROVIDER;
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";

    expect((await initiate("google")).status).toBe(404);
  });

  it("AC10: captures a same-site returnTo", async () => {
    const response = await initiate("google", "?returnTo=%2Flistings%2F5");

    // Stored server-side in the signed cookie, not echoed in the redirect.
    expect(cookie(response, OAUTH_TX_COOKIE)).toBeDefined();
    expect(location(response)).not.toContain("listings");
  });
});

describe("C2C-SEC-7 AC3/AC4/AC5 — a callback that must not log anyone in", () => {
  it("AC3: redirects with invalid_state when state does not match the cookie", async () => {
    const response = await callback("google", "?code=ada&state=attacker-state", tx());

    expect(location(response)).toContain("/login?error=invalid_state");

    const db = await getTestDb();
    expect(await db.select().from(users)).toHaveLength(0);
    expect(cookie(response, AUTH_COOKIE)).toBeUndefined();
    expect(cookie(response, REFRESH_COOKIE)).toBeUndefined();
  });

  it("AC4: redirects with expired when there is no transaction cookie", async () => {
    const response = await callback("google", "?code=ada&state=the-state");

    expect(location(response)).toContain("/login?error=expired");
    expect((await (await getTestDb()).select().from(users))).toHaveLength(0);
  });

  it("AC4: treats a tampered transaction cookie as expired", async () => {
    const response = await callback("google", "?code=ada&state=the-state", "forged.cookie");

    expect(location(response)).toContain("/login?error=expired");
  });

  it("AC5: redirects with cancelled when the user declined at the provider", async () => {
    const response = await callback("google", "?error=access_denied&state=the-state", tx());

    expect(location(response)).toContain("/login?error=cancelled");
  });

  it("redirects with invalid_state when the code is missing entirely", async () => {
    const response = await callback("google", "?state=the-state", tx());

    expect(location(response)).toMatch(/\/login\?error=/);
    expect((await (await getTestDb()).select().from(users))).toHaveLength(0);
  });

  it("rejects a transaction issued for a different provider", async () => {
    // The cookie says google; the callback arrives on github's route.
    const response = await callback("github", "?code=ada&state=the-state", tx());

    expect(location(response)).toMatch(/\/login\?error=/);
    expect((await (await getTestDb()).select().from(users))).toHaveLength(0);
  });
});

describe("C2C-SEC-7 AC6 — first-time sign-in", () => {
  it("creates a buyer with no password and a linked identity", async () => {
    const response = await callback("google", "?code=ada&state=the-state", tx());
    const db = await getTestDb();

    const [user] = await db.select().from(users);
    expect(user).toBeDefined();
    expect(user.role).toBe("buyer");
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerified).toBe(true);
    expect(user.email).toBe("ada@mock-oauth.test");

    const [link] = await db.select().from(oauthAccounts);
    expect(link.userId).toBe(user.id);
    expect(link.provider).toBe("google");

    expect(location(response)).not.toContain("error=");
  });

  it("never takes the role from anything the provider sends", async () => {
    // SEC-1's rule holds here too: registration through OAuth cannot mint an admin.
    await callback("google", "?code=admin&state=the-state", tx());

    const db = await getTestDb();
    const [user] = await db.select().from(users);
    expect(user.role).toBe("buyer");
  });
});

describe("C2C-SEC-7 AC7 — a returning user", () => {
  it("logs into the existing account without duplicating anything", async () => {
    await callback("google", "?code=ada&state=the-state", tx());
    await callback("google", "?code=ada&state=the-state", tx());

    const db = await getTestDb();
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(oauthAccounts)).toHaveLength(1);
  });

  it("matches on the provider account id, not the email", async () => {
    // The identity is keyed on the provider's stable id; an email change upstream
    // must not create a second account.
    const existing = await makeUser({ password: null, email: "old@example.test" });
    const { getOAuthProvider } = await import("@/lib/oauth/registry");
    const provider = getOAuthProvider("google")!;
    const profile = await provider.getUserInfo(
      await provider.exchangeCode({ code: "ada", redirectUri: "http://x" }),
    );
    await makeOAuthAccount({
      userId: existing.id,
      provider: "google",
      providerAccountId: profile.providerAccountId,
    });

    await callback("google", "?code=ada&state=the-state", tx());

    const db = await getTestDb();
    expect(await db.select().from(users)).toHaveLength(1);
    expect((await db.select().from(users))[0].email).toBe("old@example.test");
  });
});

describe("C2C-SEC-7 AC8/AC9 — what the browser is handed back", () => {
  it("AC8: sets the session cookies and puts no secret in the redirect URL", async () => {
    const response = await callback("google", "?code=ada&state=the-state", tx());
    const target = location(response);

    expect(cookie(response, REFRESH_COOKIE)).toBeDefined();
    expect(cookie(response, AUTH_COOKIE)).toBeDefined();

    // A token in the URL lands in browser history, server logs and the Referer
    // header of the next request.
    expect(target).not.toMatch(/token=/i);
    expect(target).not.toMatch(/code=/i);
    expect(target).not.toMatch(/secret/i);
    expect(target).not.toMatch(/eyJ/); // a JWT's opening bytes
  });

  it("AC9: clears the transaction cookie", async () => {
    const response = await callback("google", "?code=ada&state=the-state", tx());

    expect(cookie(response, OAUTH_TX_COOKIE)).toMatch(/Max-Age=0/i);
  });

  it("issues a refresh token that actually works", async () => {
    const response = await callback("google", "?code=ada&state=the-state", tx());
    const refreshCookie = cookieValue(response, REFRESH_COOKIE);

    const { POST } = await import("../refresh/route");
    const refreshed = await POST(
      new NextRequest("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: {
          cookie: `${REFRESH_COOKIE}=${refreshCookie}`,
          "x-forwarded-for": nextIp(),
        },
      }),
    );

    expect(refreshed.status).toBe(200);
  });
});

describe("C2C-SEC-7 AC10 — returnTo and open redirects", () => {
  it("lands on the captured path", async () => {
    const response = await callback(
      "google",
      "?code=ada&state=the-state",
      tx({ returnTo: "/listings/5" }),
    );

    expect(location(response)).toContain("/listings/5");
  });

  it("ignores an absolute external origin", async () => {
    const response = await callback(
      "google",
      "?code=ada&state=the-state",
      tx({ returnTo: "https://evil.test/steal" }),
    );

    expect(location(response)).not.toContain("evil.test");
  });

  it("ignores a protocol-relative URL, which a naive check misses", async () => {
    // "//evil.test" starts with a slash and is still off-site.
    const response = await callback(
      "google",
      "?code=ada&state=the-state",
      tx({ returnTo: "//evil.test/steal" }),
    );

    expect(location(response)).not.toContain("evil.test");
  });

  it("ignores a backslash-prefixed URL, which some parsers normalise", async () => {
    const response = await callback(
      "google",
      "?code=ada&state=the-state",
      tx({ returnTo: "/\\evil.test" }),
    );

    expect(location(response)).not.toContain("evil.test");
  });
});

describe("C2C-SEC-7 AC11 — an upstream failure", () => {
  it("redirects with provider_error and exposes nothing from upstream", async () => {
    // The mock provider rejects this sentinel code.
    const response = await callback("google", "?code=__fail__&state=the-state", tx());

    expect(location(response)).toContain("/login?error=provider_error");
    expect(location(response)).not.toMatch(/invalid_grant|unauthorized|client_secret/i);
    expect((await (await getTestDb()).select().from(users))).toHaveLength(0);
  });
});

describe("C2C-SEC-7 AC12 — an email collision is not auto-linked", () => {
  it("does not attach the identity to an existing password account", async () => {
    // SEC-8 owns the linking policy; what SEC-7 must guarantee is that the collision
    // never silently becomes a link, which would be account takeover.
    const existing = await makeUser({
      email: "ada@mock-oauth.test",
      password: "password123",
    });

    const response = await callback("google", "?code=ada&state=the-state", tx());
    const db = await getTestDb();

    expect(await db.select().from(oauthAccounts)).toHaveLength(0);
    expect(await db.select().from(users)).toHaveLength(1);
    // Not logged in as that user.
    expect(cookie(response, REFRESH_COOKIE)).toBeUndefined();
    expect(location(response)).toMatch(/link-account|error=/);

    const [unchanged] = await db
      .select()
      .from(users)
      .where(eq(users.id, existing.id));
    expect(unchanged.passwordHash).not.toBeNull();
  });
});
