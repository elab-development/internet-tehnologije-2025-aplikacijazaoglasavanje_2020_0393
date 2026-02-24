import { NextRequest } from "next/server";
import { authenticate, AuthError } from "@/lib/middleware";
import { jsonError, jsonOk } from "@/lib/response";

// JWTs are stateless — the canonical logout is client-side token discard.
// This endpoint authenticates the request (so an invalid/expired token gets a
// 401) and returns a confirmation the client should use to clear its stored token.
//
// To add server-side blocklisting (e.g. Redis TTL = remaining token lifetime),
// insert the jti/sub + exp into the blocklist here, then check it in authenticate().

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out the current user
 *     description: |
 *       Validates the JWT and returns a confirmation. The client should discard
 *       the token on its side. JWTs are stateless so server-side invalidation
 *       is a no-op unless a blocklist is implemented.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout confirmed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 *                 hint:
 *                   type: string
 *                   example: Discard the token on the client side
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
    // Placeholder for server-side blocklist:
    // await blocklist.add(payload.sub, payload.exp);

    return jsonOk({
      message: "Logged out successfully",
      hint: "Discard the token on the client side",
      sub: payload.sub,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[POST /api/auth/logout]", err);
    return jsonError("Internal server error", 500);
  }
}
