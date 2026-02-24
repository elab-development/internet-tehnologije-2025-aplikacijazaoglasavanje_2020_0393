import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { sanitizeUser } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/response";

// ─── GET /api/users ───────────────────────────────────────────────────────────
// Admin only. Returns all users (without passwordHash).
/**
 * @swagger
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: List all users
 *     description: Returns all users sorted by creation date. Admin only. Passwords are excluded.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Not an admin
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
 */export async function GET(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("admin")(payload);

    const rows = await db.select().from(users).orderBy(users.createdAt);

    return jsonOk(rows.map(sanitizeUser));
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/users]", err);
    return jsonError("Internal server error");
  }
}
