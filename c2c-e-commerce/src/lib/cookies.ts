// ─── Auth cookie ──────────────────────────────────────────────────────────────
// The JWT is delivered to browsers as an httpOnly cookie so that page scripts
// -- and therefore any XSS -- cannot read it. Programmatic clients (Swagger UI,
// Postman, the seminar's API examples) keep using the Authorization header;
// authenticate() accepts either.

/** Name of the cookie carrying the JWT. */
export const AUTH_COOKIE = "auth_token";

/**
 * Lifetime in seconds. Must track JWT_EXPIRES_IN in lib/auth.ts: a cookie that
 * outlives its token leaves the browser sending a credential the server has
 * already stopped honouring.
 */
export const AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export type AuthCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

/**
 * Options for setting the auth cookie.
 *
 * `sameSite: "lax"` is what defends state-changing requests here: the browser
 * withholds the cookie from cross-site POST/PUT/DELETE, so a third-party page
 * cannot ride the session. It is not a substitute for CSRF tokens if this app
 * ever needs to accept genuine cross-site form posts.
 *
 * `secure` is off outside production so the cookie still works over plain HTTP
 * on localhost.
 */
export function authCookieOptions(): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  };
}

/** Options for clearing the auth cookie. Must match the attributes it was set
 *  with, apart from the expiry, or the browser keeps the original. */
export function clearedAuthCookieOptions(): AuthCookieOptions {
  return { ...authCookieOptions(), maxAge: 0 };
}
