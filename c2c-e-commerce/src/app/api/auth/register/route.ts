import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, signToken, sanitizeUser } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/response";
import { getClientIp, rateLimit, REGISTER_RATE_LIMIT } from "@/lib/rate-limit";
import { parseRequest, RegisterBodySchema } from "@/lib/validation";
import { AUTH_COOKIE, authCookieOptions } from "@/lib/cookies";

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     description: Creates a new user account and returns a JWT token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: jane@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: secret123
 *               name:
 *                 type: string
 *                 example: Jane Doe
 *               role:
 *                 type: string
 *                 enum: [buyer, seller]
 *                 default: buyer
 *                 example: buyer
 *     responses:
 *       201:
 *         description: Registration successful
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
 *       409:
 *         description: Email already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many registration attempts from this IP
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
    // Registration runs bcrypt at 12 rounds, so unbounded signups are also a
    // cheap way to burn CPU. Limit before we touch the DB.
    const limit = rateLimit(
      `register:${getClientIp(request)}`,
      REGISTER_RATE_LIMIT
    );
    if (!limit.allowed) {
      return jsonError("Too many registration attempts. Please try again later.", 429, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    // ── Validation ────────────────────────────────────────────────────────────
    // RegisterBodySchema's role enum is restricted to buyer/seller, so admin can
    // never be self-assigned here.
    const parsed = await parseRequest(request, RegisterBodySchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { email, password, name, phoneNumber, role } = parsed.data;

    // ── Uniqueness check ──────────────────────────────────────────────────────
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return jsonError(
        "An account with that email already exists",
        409
      );
    }

    // ── Create user ───────────────────────────────────────────────────────────
    const passwordHash = await hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name, phoneNumber: phoneNumber ?? null, role })
      .returning();

    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    // Same as login: cookie for the browser, body token for API clients.
    const response = jsonOk({ user: sanitizeUser(user), token }, 201);
    response.cookies.set(AUTH_COOKIE, token, authCookieOptions());
    return response;
  } catch (err) {
    console.error("[POST /api/auth/register]", err);
    return jsonError("Internal server error");
  }
}
