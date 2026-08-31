import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isUniqueViolation } from "@/db/pg-errors";
import { USERS_EMAIL_LOWER_INDEX } from "@/db/users";
import { hashPassword, signToken, sanitizeUser } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/response";
import {
  rateLimitByIp,
  rateLimitByKey,
  rateLimitHeaders,
  REGISTER_RATE_LIMIT,
} from "@/lib/rate-limit";
import { clientIdentity } from "@/lib/client-ip";
import { parseRequest, RegisterBodySchema } from "@/lib/validation";
import { AUTH_COOKIE, authCookieOptions } from "@/lib/cookies";
import { REFRESH_COOKIE, refreshCookieOptions } from "@/lib/refresh-cookies";
import { issueRefreshToken } from "@/lib/refresh-token";

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
    const byIp = rateLimitByIp("register", request, REGISTER_RATE_LIMIT);
    if (byIp.applied && !byIp.result.allowed) {
      return jsonError(
        "Too many registration attempts. Please try again later.",
        429,
        rateLimitHeaders(byIp.result, REGISTER_RATE_LIMIT),
      );
    }

    // ── Validation ────────────────────────────────────────────────────────────
    // RegisterBodySchema's role enum is restricted to buyer/seller, so admin can
    // never be self-assigned here.
    const parsed = await parseRequest(request, RegisterBodySchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    // The key that survives IP rotation, and the only one that applies at all when no
    // proxy is trusted. Normalised the same way the column is, so `A@x.com` and
    // `a@x.com` cannot each get their own budget against one account.
    const byAccount = rateLimitByKey(
      `register:email:${parsed.data.email.trim().toLowerCase()}`,
      REGISTER_RATE_LIMIT,
    );
    if (!byAccount.allowed) {
      return jsonError(
        "Too many registration attempts. Please try again later.",
        429,
        rateLimitHeaders(byAccount, REGISTER_RATE_LIMIT),
      );
    }

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

    let user;
    try {
      [user] = await db
        .insert(users)
        .values({ email, passwordHash, name, phoneNumber: phoneNumber ?? null, role })
        .returning();
    } catch (err) {
      // The pre-check above is a courtesy; two simultaneous registrations both pass it
      // and only the index decides. Reaching here is a real conflict, not a server
      // fault, and it used to surface as a 500.
      if (isUniqueViolation(err, USERS_EMAIL_LOWER_INDEX)) {
        return jsonError("An account with that email already exists", 409);
      }
      throw err;
    }

    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    // Same as login: cookie for the browser, body token for API clients.
    const identity = clientIdentity(request);
    const refresh = await issueRefreshToken(user.id, {
      userAgent: request.headers.get("user-agent"),
      ip: identity.kind === "ip" ? identity.value : null,
    });

    const response = jsonOk({ user: sanitizeUser(user), token }, 201);
    response.cookies.set(AUTH_COOKIE, token, authCookieOptions());
    response.cookies.set(REFRESH_COOKIE, refresh.token, refreshCookieOptions());
    return response;
  } catch (err) {
    console.error("[POST /api/auth/register]", err);
    return jsonError("Internal server error");
  }
}
