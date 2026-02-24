import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticate, AuthError } from "@/lib/middleware";
import { sanitizeUser, hashPassword } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/response";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

// ─── GET /api/users/[id] ──────────────────────────────────────────────────────
// Admin or self.

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user by ID
 *     description: Returns a single user profile. Admin can view any user; regular users can only view themselves.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid user id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
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
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid user id", 400);

    if (payload.role !== "admin" && payload.sub !== id) {
      return jsonError("Forbidden", 403);
    }

    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return jsonError("User not found", 404);

    return jsonOk(sanitizeUser(user));
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/users/[id]]", err);
    return jsonError("Internal server error");
  }
}

// ─── PUT /api/users/[id] ──────────────────────────────────────────────────────
// Admin or self.
// Editable fields:
//   - self:  name, phoneNumber, password
//   - admin: all of the above + role

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     tags: [Users]
 *     summary: Update a user
 *     description: |
 *       Updates a user profile. Partial updates supported.
 *       - **Self**: can update name, phoneNumber, password.
 *       - **Admin**: can additionally update role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: John Updated
 *               phoneNumber:
 *                 type: string
 *                 nullable: true
 *                 example: "+381601234567"
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: newpassword123
 *               role:
 *                 type: string
 *                 enum: [buyer, seller, admin]
 *                 description: Admin only
 *                 example: seller
 *     responses:
 *       200:
 *         description: User updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
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
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid user id", 400);

    if (payload.role !== "admin" && payload.sub !== id) {
      return jsonError("Forbidden", 403);
    }

    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return jsonError("User not found", 404);

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);

    const { name, phoneNumber, password, role } = body as Record<string, unknown>;

    const updates: Partial<typeof users.$inferInsert> = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) return jsonError("name must be a non-empty string", 400);
      updates.name = name.trim();
    }

    if (phoneNumber !== undefined) {
      updates.phoneNumber = phoneNumber === null ? null : String(phoneNumber).trim();
    }

    if (password !== undefined) {
      if (typeof password !== "string" || password.length < 8) {
        return jsonError("password must be at least 8 characters", 400);
      }
      updates.passwordHash = await hashPassword(password);
    }

    if (role !== undefined) {
      if (payload.role !== "admin") return jsonError("Only admins may change roles", 403);
      const allowed = ["buyer", "seller", "admin"] as const;
      if (!allowed.includes(role as (typeof allowed)[number])) {
        return jsonError(`role must be one of: ${allowed.join(", ")}`, 400);
      }
      updates.role = role as (typeof allowed)[number];
    }

    if (Object.keys(updates).length === 0) return jsonError("No updatable fields provided", 400);

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();

    return jsonOk(sanitizeUser(updated));
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PUT /api/users/[id]]", err);
    return jsonError("Internal server error");
  }
}

// ─── DELETE /api/users/[id] ───────────────────────────────────────────────────
// Admin only.

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Delete a user
 *     description: Permanently removes a user account. Admin only.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User deleted successfully
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
 *       404:
 *         description: User not found
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
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    if (payload.role !== "admin") return jsonError("Forbidden", 403);

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid user id", 400);

    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return jsonError("User not found", 404);

    await db.delete(users).where(eq(users.id, id));

    return jsonOk({ message: "User deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/users/[id]]", err);
    return jsonError("Internal server error");
  }
}
