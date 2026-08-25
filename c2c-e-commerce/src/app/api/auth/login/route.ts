import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, signToken, sanitizeUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/response";
import { getClientIp, rateLimit, LOGIN_RATE_LIMIT } from "@/lib/rate-limit";
import { parseRequest, LoginBodySchema } from "@/lib/validation";
import { AUTH_COOKIE, authCookieOptions } from "@/lib/cookies";

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in a user
 *     description: Authenticates a user with email and password and returns a JWT token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               password:
 *                 type: string
 *                 example: secret123
 *     responses:
 *       200:
 *         description: Login successful
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
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many login attempts from this IP
 *         headers:
 *           Retry-After:
 *             schema:
 *               type: integer
 *             description: Seconds to wait before retrying
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
    // ── Rate limit ────────────────────────────────────────────────────────────
    // Before any DB or bcrypt work, so a flood costs us as little as possible.
    const limit = rateLimit(`login:${getClientIp(request)}`, LOGIN_RATE_LIMIT);
    if (!limit.allowed) {
      return jsonError("Too many login attempts. Please try again later.", 429, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    // ── Validation ────────────────────────────────────────────────────────────
    // LoginBodySchema deliberately requires only a non-empty email, not a
    // well-formed one: login should not reveal anything the credential check
    // wouldn't.
    const parsed = await parseRequest(request, LoginBodySchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { email, password } = parsed.data;

    // ── Look up user ──────────────────────────────────────────────────────────
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Use a consistent error message to avoid user enumeration
    const invalidCredentials = jsonError("Invalid email or password", 401);

    if (!user) return invalidCredentials;

    const passwordMatch = await verifyPassword(password, user.passwordHash);
    if (!passwordMatch) return invalidCredentials;

    // ── Issue token ───────────────────────────────────────────────────────────
    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    // Browsers authenticate with the httpOnly cookie. The token stays in the
    // body for API clients (Swagger, Postman) that send it as a Bearer header;
    // the web client ignores it and never stores it.
    const response = jsonOk({ user: sanitizeUser(user), token });
    response.cookies.set(AUTH_COOKIE, token, authCookieOptions());
    return response;
  } catch (err) {
    console.error("[POST /api/auth/login]", err);
    return jsonError("Internal server error", 500);
  }
}
