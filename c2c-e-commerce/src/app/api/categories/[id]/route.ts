import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

// ─── PUT /api/categories/[id] ─────────────────────────────────────────────────
// Admin only.

/**
 * @swagger
 * /api/categories/{id}:
 *   put:
 *     tags: [Categories]
 *     summary: Update a category
 *     description: Updates an existing category. Admin only. Partial updates supported.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Category ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Gadgets
 *               slug:
 *                 type: string
 *                 example: gadgets
 *               description:
 *                 type: string
 *                 nullable: true
 *                 example: Updated description
 *     responses:
 *       200:
 *         description: Category updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Category'
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
 *         description: Not an admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Category not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Slug already exists
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
    authorize("admin")(payload);

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid category id", 400);

    const [category] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!category) return jsonError("Category not found", 404);

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);

    const { name, slug, description } = body as Record<string, unknown>;

    const updates: Partial<typeof categories.$inferInsert> = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) return jsonError("name must be a non-empty string", 400);
      updates.name = name.trim();
    }

    if (slug !== undefined) {
      if (typeof slug !== "string" || !slug.trim()) return jsonError("slug must be a non-empty string", 400);
      // uniqueness check (exclude self)
      const [conflict] = await db
        .select()
        .from(categories)
        .where(eq(categories.slug, slug.trim()))
        .limit(1);
      if (conflict && conflict.id !== id) return jsonError("A category with that slug already exists", 409);
      updates.slug = slug.trim();
    }

    if (description !== undefined) {
      updates.description = description === null ? null : String(description).trim();
    }

    if (Object.keys(updates).length === 0) return jsonError("No updatable fields provided", 400);

    const [updated] = await db
      .update(categories)
      .set(updates)
      .where(eq(categories.id, id))
      .returning();

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PUT /api/categories/[id]]", err);
    return jsonError("Internal server error");
  }
}

// ─── DELETE /api/categories/[id] ─────────────────────────────────────────────
// Admin only.

/**
 * @swagger
 * /api/categories/{id}:
 *   delete:
 *     tags: [Categories]
 *     summary: Delete a category
 *     description: Permanently removes a category. Admin only.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Category ID
 *     responses:
 *       200:
 *         description: Category deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Category deleted successfully
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
 *         description: Category not found
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
    authorize("admin")(payload);

    const id = parseId((await params).id);
    if (!id) return jsonError("Invalid category id", 400);

    const [category] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!category) return jsonError("Category not found", 404);

    await db.delete(categories).where(eq(categories.id, id));

    return jsonOk({ message: "Category deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/categories/[id]]", err);
    return jsonError("Internal server error");
  }
}
