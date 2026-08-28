import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import { oauthAccounts, users } from "@/db/schema";
import { sanitizeUser, signToken, verifyPassword } from "@/lib/auth";
import { AUTH_COOKIE, authCookieOptions } from "@/lib/cookies";
import {
  LINK_COOKIE,
  clearedLinkCookieOptions,
  openLinkToken,
} from "@/lib/oauth/link-token";
import {
  LINK_RATE_LIMIT,
  getClientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { REFRESH_COOKIE, refreshCookieOptions } from "@/lib/refresh-cookies";
import { issueRefreshToken } from "@/lib/refresh-token";
import { jsonError, jsonOk } from "@/lib/response";

/**
 * @swagger
 * /api/auth/oauth/link:
 *   post:
 *     tags: [Auth]
 *     summary: Attach an external identity to an existing password account
 *     description: >
 *       Completes the collision flow started by the OAuth callback. Requires the signed
 *       `link_tx` cookie **and** the existing account's password (decision D9): a
 *       provider-supplied email address is not proof of ownership, so the account's own
 *       credential is what authorises the link.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string }
 *     responses:
 *       200: { description: Linked and signed in }
 *       401: { description: Missing or invalid link token, or wrong password }
 *       409: { description: The identity is already linked }
 *       429: { description: Too many attempts }
 */
export async function POST(request: NextRequest) {
  try {
    // This endpoint checks a password, so it is a credential-guessing surface and gets
    // the same treatment as login.
    const limit = rateLimit(`oauth-link:${getClientIp(request)}`, LINK_RATE_LIMIT);
    if (!limit.allowed) {
      return jsonError(
        "Too many attempts. Please try again later.",
        429,
        rateLimitHeaders(limit, LINK_RATE_LIMIT),
      );
    }

    const sealed = request.cookies.get(LINK_COOKIE)?.value;
    if (!sealed) return jsonError("Link request has expired", 401);

    const token = openLinkToken(sealed);
    if (!token) return jsonError("Link request has expired", 401);

    const body = (await request.json().catch(() => ({}))) as { password?: string };
    if (typeof body.password !== "string" || body.password.length === 0) {
      return jsonError("password is required", 400);
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, token.userId))
      .limit(1);

    // Deliberately the same wording and status as a failed login: this must not tell
    // an attacker whether the account exists or which half of the pair was wrong.
    const invalid = jsonError("Invalid email or password", 401);
    if (!user) return invalid;

    const matches = await verifyPassword(body.password, user.passwordHash);
    if (!matches) return invalid;

    // Single use. The token itself carries no server state, so "already linked" is
    // what makes a replay inert -- and the composite unique index is the backstop if
    // two requests race.
    const [alreadyLinked] = await db
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, token.provider),
          eq(oauthAccounts.providerAccountId, token.providerAccountId),
        ),
      )
      .limit(1);

    if (alreadyLinked) {
      const spent = jsonError("This account is already linked", 409);
      spent.cookies.set(LINK_COOKIE, "", clearedLinkCookieOptions());
      return spent;
    }

    await db.insert(oauthAccounts).values({
      userId: user.id,
      provider: token.provider,
      providerAccountId: token.providerAccountId,
      providerEmail: token.providerEmail,
    });

    // Proving the password is a full sign-in, so issue the session here rather than
    // bouncing the user to the login form they have just satisfied.
    const accessToken = signToken({ sub: user.id, email: user.email, role: user.role });
    const refresh = await issueRefreshToken(user.id, {
      userAgent: request.headers.get("user-agent"),
      ip: getClientIp(request),
    });

    const response = jsonOk({ user: sanitizeUser(user), token: accessToken });
    response.cookies.set(AUTH_COOKIE, accessToken, authCookieOptions());
    response.cookies.set(REFRESH_COOKIE, refresh.token, refreshCookieOptions());
    response.cookies.set(LINK_COOKIE, "", clearedLinkCookieOptions());
    return response;
  } catch (err) {
    console.error("[POST /api/auth/oauth/link]", err);
    return jsonError("Internal server error", 500);
  }
}
