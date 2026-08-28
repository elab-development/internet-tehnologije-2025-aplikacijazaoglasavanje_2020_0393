import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isSelfOrAdmin } from "@/lib/authorization";
import { authenticate, AuthError } from "@/lib/middleware";
import { sanitizeUser, hashPassword } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/response";
import { parseResourceId } from "@/lib/params";
import { parseRequest, UpdateUserSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };


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

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid user id", 400);

    if (!isSelfOrAdmin(payload, id)) {
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

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid user id", 400);

    if (!isSelfOrAdmin(payload, id)) {
      return jsonError("Forbidden", 403);
    }

    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return jsonError("User not found", 404);

    const parsed = await parseRequest(request, UpdateUserSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { name, phoneNumber, password, role } = parsed.data;

    const updates: Partial<typeof users.$inferInsert> = {};

    if (name !== undefined) updates.name = name;
    if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;
    if (password !== undefined) updates.passwordHash = await hashPassword(password);

    if (role !== undefined) {
      // The schema permits "admin" because admins may grant it; authorisation,
      // not validation, is what keeps a self-update from escalating.
      if (payload.role !== "admin") return jsonError("Only admins may change roles", 403);
      updates.role = role;
    }

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

    const id = parseResourceId((await params).id);
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
