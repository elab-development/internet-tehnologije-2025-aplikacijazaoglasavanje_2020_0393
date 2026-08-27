// ─── Refresh cookie ───────────────────────────────────────────────────────────
// The refresh token's transport. Separate from the access cookie in lib/cookies.ts
// because the two differ in the attribute that matters most here: scope.

/** Name of the cookie carrying the refresh token. */
export const REFRESH_COOKIE = "refresh_token";

/** Lifetime in seconds. Must track REFRESH_TOKEN_TTL_DAYS in lib/refresh-token.ts. */
export const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export type RefreshCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

/**
 * Options for setting the refresh cookie.
 *
 * `path: "/api/auth"` is the point of having a second cookie at all: the refresh token
 * is a 30-day credential, so it should not ride along on every image request and every
 * API call that has no use for it. Narrowing the path shrinks how much of the app can
 * leak it.
 *
 * `sameSite: "lax"` rather than `"strict"` because the OAuth callback in SEC-7 is a
 * top-level cross-site redirect back into this app, and `strict` would withhold the
 * cookie on exactly that navigation.
 */
export function refreshCookieOptions(): RefreshCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE,
  };
}

/** Options for clearing the refresh cookie. Attributes must match those it was set
 *  with, apart from the expiry, or the browser keeps the original. */
export function clearedRefreshCookieOptions(): RefreshCookieOptions {
  return { ...refreshCookieOptions(), maxAge: 0 };
}
