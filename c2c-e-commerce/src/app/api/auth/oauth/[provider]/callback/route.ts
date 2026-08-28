import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { oauthAccounts, users, type User } from "@/db/schema";
import { signToken } from "@/lib/auth";
import { AUTH_COOKIE, authCookieOptions } from "@/lib/cookies";
import {
  LINK_COOKIE,
  linkCookieOptions,
  sealLinkToken,
} from "@/lib/oauth/link-token";
import { getOAuthProvider, redirectUriFor } from "@/lib/oauth/registry";
import { DEFAULT_RETURN_TO, safeReturnTo } from "@/lib/oauth/return-to";
import {
  OAUTH_TX_COOKIE,
  clearedOAuthTxCookieOptions,
  openTransaction,
} from "@/lib/oauth/state";
import type { NormalizedProfile, ProviderName } from "@/lib/oauth/types";
import {
  OAUTH_CALLBACK_RATE_LIMIT,
  getClientIp,
  rateLimit,
} from "@/lib/rate-limit";
import { REFRESH_COOKIE, refreshCookieOptions } from "@/lib/refresh-cookies";
import { issueRefreshToken } from "@/lib/refresh-token";
import { jsonError } from "@/lib/response";

/** Every way this can go wrong, as a code the login page maps to a message (SEC-9). */
type CallbackError =
  | "invalid_state"
  | "expired"
  | "cancelled"
  | "provider_error"
  | "email_unverified";

const BASE = () => process.env.OAUTH_REDIRECT_BASE_URL ?? "http://localhost:3000";

/**
 * Every failure exits here: one redirect, one code, nothing from upstream.
 *
 * The provider's own error body is deliberately never forwarded — it can echo request
 * parameters, and this string ends up in the address bar and the next request's
 * `Referer`.
 */
function fail(error: CallbackError): NextResponse {
  const response = NextResponse.redirect(`${BASE()}/login?error=${error}`, 302);
  response.cookies.set(OAUTH_TX_COOKIE, "", clearedOAuthTxCookieOptions());
  return response;
}

/**
 * @swagger
 * /api/auth/oauth/{provider}/callback:
 *   get:
 *     tags: [Auth]
 *     summary: OAuth2 callback
 *     description: >
 *       Validates `state` against the signed transaction cookie, exchanges the code,
 *       resolves or creates the user, and issues the session cookies. The access token
 *       is never placed in the redirect URL: it would land in browser history, server
 *       logs and the `Referer` header. The client picks the session up from the cookies.
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [google, github] }
 *     responses:
 *       302:
 *         description: Redirect into the app on success, or to /login?error=<code>
 *       404:
 *         description: Unknown or unconfigured provider
 *       429:
 *         description: Too many attempts from this IP
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const limit = rateLimit(
      `oauth-callback:${getClientIp(request)}`,
      OAUTH_CALLBACK_RATE_LIMIT,
    );
    if (!limit.allowed) {
      return jsonError("Too many sign-in attempts. Please try again later.", 429, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    const { provider: name } = await params;
    const provider = getOAuthProvider(name);
    if (!provider) return jsonError("Unknown provider", 404);

    const query = request.nextUrl.searchParams;

    // The user pressed "cancel" at the provider. Not a fault, and not logged as one.
    if (query.get("error")) {
      return fail(query.get("error") === "access_denied" ? "cancelled" : "provider_error");
    }

    // ── The transaction ───────────────────────────────────────────────────────
    // Absent, tampered, or older than ten minutes all land here. A third-party-cookie
    // blocker produces the same symptom as an expiry, so the message is retry-able.
    const sealed = request.cookies.get(OAUTH_TX_COOKIE)?.value;
    if (!sealed) return fail("expired");

    const transaction = openTransaction(sealed);
    if (!transaction) return fail("expired");

    // The cookie names the provider it was issued for; a transaction started at Google
    // must not be completed at GitHub's callback.
    if (transaction.provider !== provider.id) return fail("invalid_state");

    const state = query.get("state");
    if (!state || state !== transaction.state) return fail("invalid_state");

    const code = query.get("code");
    if (!code) return fail("invalid_state");

    // ── Talk to the provider ──────────────────────────────────────────────────
    let profile: NormalizedProfile;
    try {
      const accessToken = await provider.exchangeCode({
        code,
        redirectUri: redirectUriFor(provider.id),
        codeVerifier: transaction.codeVerifier,
      });
      profile = await provider.getUserInfo(accessToken);
    } catch (err) {
      // Logged server-side with detail; the browser gets a bare code.
      console.error(`[oauth callback ${provider.id}]`, err);
      return fail("provider_error");
    }

    // ── Resolve the user ──────────────────────────────────────────────────────
    const resolved = await resolveUser(provider.id, profile);

    if (resolved.outcome === "email_unverified") return fail("email_unverified");

    // The collision path (decision D9). The user is NOT signed in here: they are handed
    // a challenge and have to produce the existing account's password before the
    // identity is attached. Auto-linking on a provider-supplied address is exactly the
    // takeover this avoids.
    if (resolved.outcome === "needs_link") {
      return offerLink(provider.id, resolved.userId, resolved.profile, transaction.returnTo);
    }

    return signIn(resolved.user, transaction.returnTo, request);
  } catch (err) {
    console.error("[GET /api/auth/oauth/[provider]/callback]", err);
    return fail("provider_error");
  }
}

type Resolution =
  | { outcome: "ok"; user: User }
  | { outcome: "email_unverified" }
  /** A verified address already held by a password account: SEC-8 takes over. */
  | { outcome: "needs_link"; userId: number; profile: NormalizedProfile };

/**
 * Finds the user this external identity belongs to, creating one if appropriate.
 *
 * Three cases, in order:
 *   1. the identity is already linked → that user, always. Matching is on the
 *      provider's account id, so changing an email upstream cannot fork an account.
 *   2. no account holds that email → create one.
 *   3. an account already holds that email → do **not** link. Auto-linking on a
 *      provider-supplied address is the account-takeover vector decision D9 exists to
 *      close; SEC-8 owns the flow that lets the real owner prove ownership.
 */
async function resolveUser(
  provider: ProviderName,
  profile: NormalizedProfile,
): Promise<Resolution> {
  const [link] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerAccountId, profile.providerAccountId),
      ),
    )
    .limit(1);

  if (link) {
    const [user] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1);
    if (user) return { outcome: "ok", user };
  }

  // An unverified address proves nothing about who is signing in, so it can neither
  // link nor seed a new account under that address.
  if (!profile.emailVerified) return { outcome: "email_unverified" };

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, profile.email))
    .limit(1);

  if (existing) return { outcome: "needs_link", userId: existing.id, profile };

  const [created] = await db
    .insert(users)
    .values({
      email: profile.email,
      // Never from the provider: SEC-1's rule holds on this path too.
      role: "buyer",
      passwordHash: null,
      name: profile.name ?? profile.email,
      emailVerified: profile.emailVerified,
      avatarUrl: profile.avatarUrl,
    })
    .returning();

  await db.insert(oauthAccounts).values({
    userId: created.id,
    provider,
    providerAccountId: profile.providerAccountId,
    providerEmail: profile.email,
  });

  return { outcome: "ok", user: created };
}

/**
 * Sends the user to the link screen with a signed, short-lived challenge.
 *
 * The token rides in an httpOnly cookie rather than the query string: a redirect URL
 * ends up in browser history and in the `Referer` of whatever the page loads next.
 */
function offerLink(
  provider: ProviderName,
  userId: number,
  profile: NormalizedProfile,
  returnTo: string | undefined,
): NextResponse {
  const destination = new URL(`${BASE()}/link-account`);
  destination.searchParams.set("provider", provider);
  if (returnTo) destination.searchParams.set("returnTo", safeReturnTo(returnTo));

  const response = NextResponse.redirect(destination.toString(), 302);
  response.cookies.set(
    LINK_COOKIE,
    sealLinkToken({
      userId,
      provider,
      providerAccountId: profile.providerAccountId,
      providerEmail: profile.email,
    }),
    linkCookieOptions(),
  );
  response.cookies.set(OAUTH_TX_COOKIE, "", clearedOAuthTxCookieOptions());
  return response;
}

/** Issues the session cookies and redirects into the app. */
async function signIn(
  user: User,
  returnTo: string | undefined,
  request: NextRequest,
): Promise<NextResponse> {
  const token = signToken({ sub: user.id, email: user.email, role: user.role });

  const refresh = await issueRefreshToken(user.id, {
    userAgent: request.headers.get("user-agent"),
    ip: getClientIp(request),
  });

  // Re-checked here even though initiation already validated it: the cookie is signed,
  // but defence in depth costs one function call and this is the value that becomes a
  // Location header.
  const destination = safeReturnTo(returnTo) || DEFAULT_RETURN_TO;

  const response = NextResponse.redirect(`${BASE()}${destination}`, 302);
  response.cookies.set(AUTH_COOKIE, token, authCookieOptions());
  response.cookies.set(REFRESH_COOKIE, refresh.token, refreshCookieOptions());
  response.cookies.set(OAUTH_TX_COOKIE, "", clearedOAuthTxCookieOptions());

  return response;
}
