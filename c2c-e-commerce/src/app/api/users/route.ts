import { NextRequest } from "next/server";
import { asc, count } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { sanitizeUser } from "@/lib/auth";
import { parseBoundedInt } from "@/lib/params";
import { jsonOk, jsonError } from "@/lib/response";

// ─── GET /api/users ───────────────────────────────────────────────────────────
// Admin only. Returns all users (without passwordHash).
/**
 * @swagger
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: List all users
 *     description: Returns paginated users sorted by creation date. Admin only. Passwords are excluded.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Items per page (max 100)
 *     responses:
 *       200:
 *         description: Paginated users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
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

    const page = parseBoundedInt(request.nextUrl.searchParams.get("page"), {
      fallback: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const limit = parseBoundedInt(request.nextUrl.searchParams.get("limit"), {
      fallback: 20,
      max: 100,
    });

    const [{ total }] = await db.select({ total: count() }).from(users);

    const rows = await db
      .select()
      .from(users)
      // `id` breaks the tie the same way orders/seller and users/{id}/reviews already do:
      // two accounts created in the same millisecond would otherwise reorder between pages.
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(limit)
      .offset((page - 1) * limit);

    return jsonOk({
      data: rows.map(sanitizeUser),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/users]", err);
    return jsonError("Internal server error");
  }
}
