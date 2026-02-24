import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, signToken, sanitizeUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/response";

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
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return jsonError("Invalid request body", 400);
    }

    const { email, password } = body as Record<string, unknown>;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!email || typeof email !== "string") {
      return jsonError("email is required", 400);
    }
    if (!password || typeof password !== "string") {
      return jsonError("password is required", 400);
    }

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

    return jsonOk({ user: sanitizeUser(user), token });
  } catch (err) {
    console.error("[POST /api/auth/login]", err);
    return jsonError("Internal server error", 500);
  }
}
