import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, signToken, sanitizeUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/response";
import {
  rateLimitByIp,
  rateLimitByKey,
  rateLimitHeaders,
  LOGIN_RATE_LIMIT,
} from "@/lib/rate-limit";
import { clientIdentity } from "@/lib/client-ip";
import { parseRequest, LoginBodySchema } from "@/lib/validation";
import { AUTH_COOKIE, authCookieOptions } from "@/lib/cookies";
import { REFRESH_COOKIE, refreshCookieOptions } from "@/lib/refresh-cookies";
import { issueRefreshToken } from "@/lib/refresh-token";

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
    const byIp = rateLimitByIp("login", request, LOGIN_RATE_LIMIT);
    if (byIp.applied && !byIp.result.allowed) {
      return jsonError(
        "Too many login attempts. Please try again later.",
        429,
        rateLimitHeaders(byIp.result, LOGIN_RATE_LIMIT),
      );
    }

    // ── Validation ────────────────────────────────────────────────────────────
    // LoginBodySchema deliberately requires only a non-empty email, not a
    // well-formed one: login should not reveal anything the credential check
    // wouldn't.
    const parsed = await parseRequest(request, LoginBodySchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    // The key that survives IP rotation, and the only one that applies at all when no
    // proxy is trusted. Normalised the same way the column is, so `A@x.com` and
    // `a@x.com` cannot each get their own budget against one account.
    const byAccount = rateLimitByKey(
      `login:email:${parsed.data.email.trim().toLowerCase()}`,
      LOGIN_RATE_LIMIT,
    );
    if (!byAccount.allowed) {
      return jsonError(
        "Too many login attempts. Please try again later.",
        429,
        rateLimitHeaders(byAccount, LOGIN_RATE_LIMIT),
      );
    }

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
    // A login starts a new token family: this device's sessions are tracked
    // independently, so revoking one does not sign the user out everywhere.
    const identity = clientIdentity(request);
    const refresh = await issueRefreshToken(user.id, {
      userAgent: request.headers.get("user-agent"),
      ip: identity.kind === "ip" ? identity.value : null,
    });

    const response = jsonOk({ user: sanitizeUser(user), token });
    response.cookies.set(AUTH_COOKIE, token, authCookieOptions());
    response.cookies.set(REFRESH_COOKIE, refresh.token, refreshCookieOptions());
    return response;
  } catch (err) {
    console.error("[POST /api/auth/login]", err);
    return jsonError("Internal server error", 500);
  }
}
