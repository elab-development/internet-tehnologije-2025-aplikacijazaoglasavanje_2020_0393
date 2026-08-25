import { NextRequest } from "next/server";
import { authenticate, AuthError } from "@/lib/middleware";
import { jsonError, jsonOk } from "@/lib/response";
import { AUTH_COOKIE, clearedAuthCookieOptions } from "@/lib/cookies";

// Clears the httpOnly auth cookie, which ends the session for browser clients:
// scripts never had the token, so once the cookie is gone it cannot be replayed.
//
// The JWT itself remains stateless and stays valid until it expires, so a token
// held by an API client (or copied out of the cookie by someone with access to
// the browser) is unaffected. Closing that gap needs server-side state: a jti
// blocklist with TTL = remaining token lifetime, or a tokenVersion column on
// users bumped here and compared in authenticate().

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out the current user
 *     description: |
 *       Validates the JWT and clears the httpOnly `auth_token` cookie, ending
 *       the browser session. The JWT is stateless, so a token held outside the
 *       cookie stays valid until it expires.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout confirmed and auth cookie cleared
 *         headers:
 *           Set-Cookie:
 *             schema:
 *               type: string
 *             description: Expires the auth_token cookie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 *                 sub:
 *                   type: integer
 *                   example: 1
 *       401:
 *         description: Missing or invalid token
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
  try {
    const payload = authenticate(request);

    // Clearing the httpOnly cookie is a real logout for browser sessions: page
    // scripts never held the token, so once the cookie is gone the client has
    // no way to present it again.
    //
    // A token already copied out of the cookie -- or one issued to an API
    // client via the Authorization header -- stays valid until it expires.
    // Closing that gap needs server-side state (a jti blocklist, or a
    // tokenVersion column bumped here and checked in authenticate()).
    const response = jsonOk({
      message: "Logged out successfully",
      sub: payload.sub,
    });
    response.cookies.set(AUTH_COOKIE, "", clearedAuthCookieOptions());
    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[POST /api/auth/logout]", err);
    return jsonError("Internal server error", 500);
  }
}
