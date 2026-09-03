/**
 * C2C-SEC-3 spec — the session routes end to end.
 *
 * Cookie attributes are asserted from the raw `set-cookie` header rather than from
 * NextResponse's cookie API: the header is what the browser actually enforces, and a
 * missing `HttpOnly` is exactly the kind of defect that a friendlier assertion hides.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { refreshTokens } from "@/db/schema";
import { AUTH_COOKIE } from "@/lib/cookies";
import { hashRefreshToken, issueRefreshToken } from "@/lib/refresh-token";
import { REFRESH_COOKIE } from "@/lib/refresh-cookies";
import { resetRateLimits } from "@/lib/rate-limit";
import { getTestDb, resetDb } from "@/test/db";
import { makeUser } from "@/test/factories";

let clientCounter = 0;
const nextIp = () => `10.1.0.${(clientCounter += 1) % 250}`;

/** All `set-cookie` values on a response, one string per cookie. */
function setCookies(response: Response): string[] {
  const raw = response.headers.getSetCookie?.() ?? [];
  if (raw.length > 0) return raw;
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookie(response: Response, name: string): string | undefined {
  return setCookies(response).find((c) => c.startsWith(`${name}=`));
}

/** The value of a cookie as a client would send it back. */
function cookieValue(response: Response, name: string): string {
  const found = cookie(response, name);
  if (!found) throw new Error(`no ${name} cookie on response`);
  return found.slice(name.length + 1).split(";")[0];
}

async function login(email: string, password: string) {
  const { POST } = await import("../login/route");
  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ email, password }),
    }),
  );
}

async function refresh(refreshCookie?: string) {
  const { POST } = await import("./route");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": nextIp(),
  };
  if (refreshCookie) headers.cookie = `${REFRESH_COOKIE}=${refreshCookie}`;

  return POST(
    new NextRequest("http://localhost/api/auth/refresh", { method: "POST", headers }),
  );
}

async function logout(accessToken: string, refreshCookie?: string) {
  const { POST } = await import("../logout/route");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
  if (refreshCookie) headers.cookie = `${REFRESH_COOKIE}=${refreshCookie}`;

  return POST(
    new NextRequest("http://localhost/api/auth/logout", { method: "POST", headers }),
  );
}

const PASSWORD = "password123";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

describe("C2C-SEC-3 AC1 — login issues both cookies", () => {
  it("sets a refresh cookie that is HttpOnly, SameSite=Lax and scoped to /api/auth", async () => {
    const user = await makeUser({ password: PASSWORD });

    const response = await login(user.email, PASSWORD);
    const refreshCookie = cookie(response, REFRESH_COOKIE);

    expect(response.status).toBe(200);
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/SameSite=Lax/i);
    expect(refreshCookie).toMatch(/Path=\/api\/auth/i);
    // 30 days.
    expect(refreshCookie).toMatch(/Max-Age=2592000/i);
  });

  it("returns an access token that expires in 15 minutes", async () => {
    const user = await makeUser({ password: PASSWORD });

    const response = await login(user.email, PASSWORD);
    const { token } = (await response.json()) as { token: string };

    const { exp, iat } = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { exp: number; iat: number };

    expect(exp - iat).toBe(15 * 60);
  });

  it("scopes the access cookie to the whole site and expires it with the token", async () => {
    const user = await makeUser({ password: PASSWORD });

    const response = await login(user.email, PASSWORD);
    const access = cookie(response, AUTH_COOKIE);

    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/Path=\//i);
    // A cookie outliving its token leaves the browser sending a dead credential.
    expect(access).toMatch(/Max-Age=900/i);
  });

  it("persists the refresh token as a hash, never as the cookie value", async () => {
    const user = await makeUser({ password: PASSWORD });

    const response = await login(user.email, PASSWORD);
    const raw = cookieValue(response, REFRESH_COOKIE);

    const db = await getTestDb();
    const rows = await db.select().from(refreshTokens);

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashRefreshToken(raw));
    expect(JSON.stringify(rows)).not.toContain(raw);
  });

  it("registration issues a refresh cookie too", async () => {
    const { POST } = await import("../register/route");
    const response = await POST(
      new NextRequest("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
        body: JSON.stringify({
          email: "fresh@example.test",
          password: PASSWORD,
          name: "Fresh",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(cookie(response, REFRESH_COOKIE)).toBeDefined();
  });
});

describe("C2C-SEC-3 AC2 — Secure in production", () => {
  it("marks both cookies Secure when NODE_ENV is production", async () => {
    const user = await makeUser({ password: PASSWORD });
    const original = process.env.NODE_ENV;

    try {
      // NODE_ENV is readonly in the Next types but writable at runtime; the cookie
      // options read it at call time, which is the behaviour under test.
      (process.env as Record<string, string>).NODE_ENV = "production";

      const response = await login(user.email, PASSWORD);

      expect(cookie(response, REFRESH_COOKIE)).toMatch(/Secure/i);
      expect(cookie(response, AUTH_COOKIE)).toMatch(/Secure/i);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = original as string;
    }
  });

  it("omits Secure outside production, so localhost over HTTP still works", async () => {
    const user = await makeUser({ password: PASSWORD });

    const response = await login(user.email, PASSWORD);

    expect(cookie(response, REFRESH_COOKIE)).not.toMatch(/Secure/i);
  });
});

describe("C2C-SEC-3 AC3 — POST /api/auth/refresh", () => {
  it("returns 200 with a new access token and a different refresh cookie", async () => {
    const user = await makeUser({ password: PASSWORD });
    const loggedIn = await login(user.email, PASSWORD);
    const first = cookieValue(loggedIn, REFRESH_COOKIE);

    const response = await refresh(first);
    const second = cookieValue(response, REFRESH_COOKIE);

    expect(response.status).toBe(200);
    expect(second).not.toBe(first);

    const body = (await response.json()) as { token?: string; user?: { id: number } };
    expect(body.token).toBeDefined();
    expect(body.user?.id).toBe(user.id);
  });

  it("marks the presented token revoked in the database", async () => {
    const user = await makeUser({ password: PASSWORD });
    const loggedIn = await login(user.email, PASSWORD);
    const first = cookieValue(loggedIn, REFRESH_COOKIE);

    await refresh(first);

    const db = await getTestDb();
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(first)));

    expect(row.revokedAt).toBeInstanceOf(Date);
  });

  it("refreshes the access cookie as well as the body token", async () => {
    const user = await makeUser({ password: PASSWORD });
    const loggedIn = await login(user.email, PASSWORD);

    const response = await refresh(cookieValue(loggedIn, REFRESH_COOKIE));

    expect(cookie(response, AUTH_COOKIE)).toMatch(/HttpOnly/i);
  });
});

describe("C2C-SEC-3 AC5 — refresh without a cookie", () => {
  it("returns 401 and writes nothing to the database", async () => {
    const db = await getTestDb();

    const response = await refresh();

    expect(response.status).toBe(401);
    expect(await db.select().from(refreshTokens)).toHaveLength(0);
  });

  it("returns 401 for a cookie that was never issued", async () => {
    const response = await refresh("completely-made-up-token");

    expect(response.status).toBe(401);
  });
});

describe("C2C-SEC-3 AC6 — replay through the route", () => {
  it("returns 401 and revokes the whole family", async () => {
    const user = await makeUser({ password: PASSWORD });
    const loggedIn = await login(user.email, PASSWORD);
    const first = cookieValue(loggedIn, REFRESH_COOKIE);

    const rotated = await refresh(first);
    const second = cookieValue(rotated, REFRESH_COOKIE);

    const replayed = await refresh(first);
    expect(replayed.status).toBe(401);

    // The successor is dead too: the family was burned.
    expect((await refresh(second)).status).toBe(401);
  });
});

describe("C2C-SEC-3 AC7 — expired refresh token", () => {
  it("returns 401 and does not rotate the row", async () => {
    const user = await makeUser();
    const { token } = await issueRefreshToken(user.id);

    const db = await getTestDb();
    await db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));

    const response = await refresh(token);

    expect(response.status).toBe(401);
    expect(await db.select().from(refreshTokens)).toHaveLength(1);
  });
});

describe("C2C-SEC-3 AC4 — an expired access token is rejected", () => {
  it("returns 401 from a protected route", async () => {
    const user = await makeUser();
    const jwt = (await import("jsonwebtoken")).default;

    // Signed by the application's own secret, but already past its expiry — the one
    // case a 15-minute lifetime exists to produce.
    const expired = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET as string,
      { algorithm: "HS256", expiresIn: "-1s" },
    );

    const { GET } = await import("../me/route");
    const response = await GET(
      new NextRequest("http://localhost/api/auth/me", {
        headers: { authorization: `Bearer ${expired}` },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("accepts a freshly issued one, so the 401 above is about expiry", async () => {
    const user = await makeUser({ password: PASSWORD });
    const loggedIn = await login(user.email, PASSWORD);
    const { token } = (await loggedIn.json()) as { token: string };

    const { GET } = await import("../me/route");
    const response = await GET(
      new NextRequest("http://localhost/api/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(200);
  });
});

describe("C2C-SEC-3 AC8 — logout", () => {
  it("revokes the family, clears both cookies, and kills the old refresh token", async () => {
    const user = await makeUser({ password: PASSWORD });
    const loggedIn = await login(user.email, PASSWORD);
    const refreshCookie = cookieValue(loggedIn, REFRESH_COOKIE);
    const { token: accessToken } = (await loggedIn.json()) as { token: string };

    const response = await logout(accessToken, refreshCookie);
    expect(response.status).toBe(200);

    // Cleared cookies are sent as an immediate expiry.
    expect(cookie(response, REFRESH_COOKIE)).toMatch(/Max-Age=0/i);
    expect(cookie(response, AUTH_COOKIE)).toMatch(/Max-Age=0/i);

    expect((await refresh(refreshCookie)).status).toBe(401);
  });

  it("still succeeds when no refresh cookie is presented", async () => {
    // An API client using only the Authorization header has no cookie to revoke.
    const user = await makeUser({ password: PASSWORD });
    const loggedIn = await login(user.email, PASSWORD);
    const { token } = (await loggedIn.json()) as { token: string };

    expect((await logout(token)).status).toBe(200);
  });
});
