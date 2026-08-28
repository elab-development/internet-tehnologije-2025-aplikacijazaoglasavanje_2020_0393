import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { sanitizeUser, signToken } from "@/lib/auth";
import { AUTH_COOKIE, authCookieOptions } from "@/lib/cookies";
import {
  REFRESH_RATE_LIMIT,
  getClientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import {
  REFRESH_COOKIE,
  clearedRefreshCookieOptions,
  refreshCookieOptions,
} from "@/lib/refresh-cookies";
import { RefreshTokenError, rotateRefreshToken } from "@/lib/refresh-token";
import { jsonError, jsonOk } from "@/lib/response";

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access token
 *     description: >
 *       Reads the httpOnly `refresh_token` cookie, rotates it, and returns a fresh
 *       15-minute access token. Refresh tokens are single-use: presenting one that has
 *       already been rotated is treated as theft and revokes every token in its family,
 *       forcing a new login.
 *     responses:
 *       200:
 *         description: A new access token, with both session cookies refreshed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       401:
 *         description: >
 *           Missing, unknown, expired, already-used, or concurrently-rotated refresh
 *           token. The reason is deliberately not distinguished in the response.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function POST(request: NextRequest) {
  // Loose on purpose (C2C-SEC-11 AC6). Single-flight on the client means one refresh
  // per lapse, but several tabs opening together still burst, and throttling that would
  // break the session recovery this protects.
  const limit = rateLimit(`refresh:${getClientIp(request)}`, REFRESH_RATE_LIMIT);
  if (!limit.allowed) {
    return jsonError(
      "Too many refresh attempts. Please try again later.",
      429,
      rateLimitHeaders(limit, REFRESH_RATE_LIMIT),
    );
  }

  const presented = request.cookies.get(REFRESH_COOKIE)?.value;

  // No cookie is the ordinary "not logged in" case -- every page load hits this route
  // once. It must not touch the database.
  if (!presented) {
    return jsonError("Not authenticated", 401);
  }

  try {
    const rotated = await rotateRefreshToken(presented, {
      userAgent: request.headers.get("user-agent"),
      ip: getClientIp(request),
    });

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, rotated.userId))
      .limit(1);

    // The row can be gone if the account was deleted between issuance and refresh.
    if (!user) {
      const gone = jsonError("Not authenticated", 401);
      gone.cookies.set(REFRESH_COOKIE, "", clearedRefreshCookieOptions());
      return gone;
    }

    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    const response = jsonOk({ user: sanitizeUser(user), token });
    response.cookies.set(AUTH_COOKIE, token, authCookieOptions());
    response.cookies.set(REFRESH_COOKIE, rotated.token, refreshCookieOptions());
    return response;
  } catch (err) {
    if (err instanceof RefreshTokenError) {
      // One message for every reason. Telling a caller *why* their token failed
      // distinguishes "never existed" from "expired" from "already used", which is an
      // oracle for anyone probing with stolen material.
      const response = jsonError("Not authenticated", 401);

      // The cookie is spent either way; leaving it in place only guarantees the next
      // request repeats this failure.
      response.cookies.set(REFRESH_COOKIE, "", clearedRefreshCookieOptions());
      return response;
    }

    console.error("[POST /api/auth/refresh]", err);
    return jsonError("Internal server error", 500);
  }
}
