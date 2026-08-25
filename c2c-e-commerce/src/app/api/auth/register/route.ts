import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, signToken, sanitizeUser } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/response";
import { getClientIp, rateLimit, REGISTER_RATE_LIMIT } from "@/lib/rate-limit";

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

    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return jsonError(
        "Invalid request body",
        400 );
    }

    const { email, password, name, role = "buyer" } = body as Record<string, unknown>;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!email || typeof email !== "string") {
      return jsonError(
        "email is required",
        400
      );
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return jsonError(
        "password is required and must be at least 8 characters",
         400
      );
    }
    if (!name || typeof name !== "string") {
      return jsonError(
        "name is required", 
        400 
      );
    }

    // Self-registration may only ever create a buyer or a seller. Admin accounts
    // are granted by an existing admin via PUT /api/users/[id]; accepting the
    // client-supplied role verbatim here would let anyone register as admin.
    const SELF_ASSIGNABLE_ROLES = ["buyer", "seller"] as const;
    type SelfAssignableRole = (typeof SELF_ASSIGNABLE_ROLES)[number];

    if (!SELF_ASSIGNABLE_ROLES.includes(role as SelfAssignableRole)) {
      return jsonError("role must be 'buyer' or 'seller'", 400);
    }
    const safeRole: SelfAssignableRole = role as SelfAssignableRole;

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
      .values({ email, passwordHash, name, role: safeRole })
      .returning();

    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    return jsonOk({ user: sanitizeUser(user), token }, 201);
  } catch (err) {
    console.error("[POST /api/auth/register]", err);
    return jsonError("Internal server error");
  }
}
