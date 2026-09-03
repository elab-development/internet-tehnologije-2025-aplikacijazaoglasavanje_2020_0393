import { describe, it, expect, afterEach, vi } from "vitest";
import {
  AUTH_COOKIE,
  AUTH_COOKIE_MAX_AGE,
  authCookieOptions,
  clearedAuthCookieOptions,
} from "./cookies";

afterEach(() => {
  vi.unstubAllEnvs();
});

function setNodeEnv(value: string) {
  vi.stubEnv("NODE_ENV", value);
}

// ─── authCookieOptions ────────────────────────────────────────────────────────

describe("authCookieOptions", () => {
  it("is httpOnly so page scripts cannot read the token", () => {
    // This is the entire point of the migration off localStorage.
    expect(authCookieOptions().httpOnly).toBe(true);
  });

  it("is sameSite lax so cross-site writes do not carry the session", () => {
    expect(authCookieOptions().sameSite).toBe("lax");
  });

  it("is scoped to the whole site", () => {
    expect(authCookieOptions().path).toBe("/");
  });

  it("sets secure in production", () => {
    setNodeEnv("production");
    expect(authCookieOptions().secure).toBe(true);
  });

  it("leaves secure off in development so localhost HTTP works", () => {
    setNodeEnv("development");
    expect(authCookieOptions().secure).toBe(false);
  });

  it("expires with the token, not before or after", () => {
    // JWT_EXPIRES_IN in lib/auth.ts is "15m" since C2C-SEC-3. A cookie outliving the
    // token would leave the browser sending a credential the server no longer honours.
    // Losing the session at 15 minutes is not a consequence: the rotating refresh
    // cookie mints a replacement (lib/refresh-cookies.ts).
    expect(AUTH_COOKIE_MAX_AGE).toBe(15 * 60);
    expect(authCookieOptions().maxAge).toBe(AUTH_COOKIE_MAX_AGE);
  });
});

// ─── clearedAuthCookieOptions ─────────────────────────────────────────────────

describe("clearedAuthCookieOptions", () => {
  it("expires the cookie immediately", () => {
    expect(clearedAuthCookieOptions().maxAge).toBe(0);
  });

  it("matches every other attribute of the set cookie", () => {
    // A browser only replaces a cookie when name/path/domain agree, so a
    // mismatch here would leave the original cookie in place on logout.
    const set = authCookieOptions();
    const cleared = clearedAuthCookieOptions();
    expect({ ...cleared, maxAge: set.maxAge }).toEqual(set);
  });
});

// ─── AUTH_COOKIE ──────────────────────────────────────────────────────────────

describe("AUTH_COOKIE", () => {
  it("matches the name authenticate() reads", () => {
    expect(AUTH_COOKIE).toBe("auth_token");
  });
});
