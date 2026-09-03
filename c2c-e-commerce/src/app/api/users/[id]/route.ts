import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { repairAggregatesBeforeUserDelete } from "@/db/reviews";
import { users } from "@/db/schema";
import { isSelfOrAdmin } from "@/lib/authorization";
import { authenticate, AuthError } from "@/lib/middleware";
import { sanitizeUser, hashPassword, verifyPassword } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/response";
import { parseResourceId } from "@/lib/params";
import { revokeAllRefreshFamiliesForUser } from "@/lib/refresh-token";
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

// ─── PATCH /api/users/[id] ─────────────────────────────────────────────────────
// Admin or self.
// Editable fields:
//   - self:  name, phoneNumber, password
//   - admin: all of the above + role

/**
 * @swagger
 * /api/users/{id}:
 *   patch:
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
export async function PATCH(request: NextRequest, { params }: RouteContext) {
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

    const { name, phoneNumber, password, currentPassword, role } = parsed.data;

    const updates: Partial<typeof users.$inferInsert> = {};

    if (name !== undefined) updates.name = name;
    if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;

    const isSelfChange = payload.sub === id;

    if (password !== undefined) {
      // A self-change must prove knowledge of what it replaces. An admin reset is exempt:
      // an admin recovering a compromised account does not know the current password, and
      // requiring it would break the case the reset exists for. An account with no
      // password -- OAuth-only -- has nothing to prove against.
      if (isSelfChange && user.passwordHash !== null) {
        if (currentPassword === undefined) {
          return jsonError("currentPassword is required to change your own password", 400);
        }
        if (!(await verifyPassword(currentPassword, user.passwordHash))) {
          return jsonError("Current password is incorrect", 403);
        }
      }
      updates.passwordHash = await hashPassword(password);
    }

    if (role !== undefined) {
      // The schema permits "admin" because admins may grant it; authorisation,
      // not validation, is what keeps a self-update from escalating.
      if (payload.role !== "admin") return jsonError("Only admins may change roles", 403);
      updates.role = role;
    }

    // `UpdateUserSchema`'s "at least one field" refinement counts *schema* keys, and
    // `currentPassword` is the one key that never becomes an update -- it authorises a
    // password change rather than being one. So `{"currentPassword":"x"}` satisfies the
    // schema, sets nothing, and used to reach `set({})`, which Drizzle throws on
    // synchronously: a 500 on a body the client fully controls. A refusal is the honest
    // answer, and it belongs here rather than in the schema, which cannot see that this
    // particular field does not map through.
    if (Object.keys(updates).length === 0) {
      return jsonError(
        "No updatable fields provided: currentPassword only authorises a password " +
          "change, send it together with password",
        400,
      );
    }

    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx
        .update(users)
        .set(updates)
        .where(eq(users.id, id))
        .returning();

      // A password change is remediation. Leaving every existing refresh family live
      // means the credential the person is trying to invalidate still works for another
      // 30 days -- so the revocation belongs in the same transaction as the new hash,
      // not beside it where a failure could commit one without the other.
      if (updates.passwordHash !== undefined) {
        await revokeAllRefreshFamiliesForUser(tx, id);
      }

      return rows;
    });

    return jsonOk(sanitizeUser(updated));
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PATCH /api/users/[id]]", err);
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

    await db.transaction(async (tx) => {
      // Deleting this user cascades to the reviews they wrote, their orders on both
      // sides, and — through those orders — the reviews anchored to them. Every one of
      // those rows can be a review of some *other* seller, and the cascade would remove
      // it without moving that seller's `review_count`/`rating_sum` (D7). Repair those
      // third parties before the user row goes, in the same transaction, so the cascade
      // and the compensation commit or roll back together.
      await repairAggregatesBeforeUserDelete(tx, id);
      await tx.delete(users).where(eq(users.id, id));
    });

    return jsonOk({ message: "User deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/users/[id]]", err);
    return jsonError("Internal server error");
  }
}
