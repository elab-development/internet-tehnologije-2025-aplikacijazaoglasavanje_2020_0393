import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { findCategoryById, hasChildren, rewriteSubtreePaths, subtreeHeight } from "@/db/categories";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import {
  MAX_CATEGORY_DEPTH,
  childPath,
  depthOfPath,
  wouldCreateCycle,
} from "@/lib/categories";
import { jsonOk, jsonError } from "@/lib/response";
import { parseResourceId } from "@/lib/params";
import { parseRequest, UpdateCategorySchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };


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

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid category id", 400);

    const [category] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!category) return jsonError("Category not found", 404);

    const parsed = await parseRequest(request, UpdateCategorySchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { name, slug, description, parentId, sortOrder } = parsed.data;

    const updates: Partial<typeof categories.$inferInsert> = {};

    if (name !== undefined) updates.name = name;

    if (slug !== undefined) {
      // uniqueness check (exclude self)
      const [conflict] = await db
        .select()
        .from(categories)
        .where(eq(categories.slug, slug))
        .limit(1);
      if (conflict && conflict.id !== id) return jsonError("A category with that slug already exists", 409);
      updates.slug = slug;
    }

    if (description !== undefined) updates.description = description;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;

    // ── Re-parenting ────────────────────────────────────────────────────────
    // `undefined` means "leave the parent alone"; an explicit `null` means "make this a
    // root". Branching on falsiness would conflate the two and silently promote nodes.
    let subtreeMove: { oldPrefix: string; newPrefix: string; depthDelta: number } | null =
      null;

    if (parentId !== undefined) {
      let newParentPath: string | null = null;

      if (parentId !== null) {
        if (parentId === id) {
          return jsonError("A category cannot be moved under its own descendant", 400);
        }

        const parent = await findCategoryById(parentId);
        if (!parent) return jsonError("Parent category not found", 400);

        if (wouldCreateCycle(category.path, parent.path)) {
          return jsonError("A category cannot be moved under its own descendant", 400);
        }

        // The subtree travels with the node, so the cap applies to its deepest leaf,
        // not just to the node being moved.
        const height = await subtreeHeight(category.path);
        if (parent.depth + 1 + height > MAX_CATEGORY_DEPTH - 1) {
          return jsonError(
            `Categories may be nested at most ${MAX_CATEGORY_DEPTH} levels deep`,
            400,
          );
        }

        newParentPath = parent.path;
      }

      const newPath = childPath(newParentPath, id);
      const newDepth = newParentPath === null ? 0 : depthOfPath(newParentPath) + 1;

      updates.parentId = parentId;
      updates.path = newPath;
      updates.depth = newDepth;

      subtreeMove = {
        oldPrefix: category.path,
        newPrefix: newPath,
        depthDelta: newDepth - category.depth,
      };
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(categories)
        .set(updates)
        .where(eq(categories.id, id))
        .returning();

      // Descendants must be rewritten in the same transaction as the node itself, which
      // is why `tx` is threaded through rather than the module-level `db`: a half-applied
      // move leaves paths disagreeing with parentId, and every descendant filter quietly
      // returns the wrong listings from then on.
      if (subtreeMove) {
        await rewriteSubtreePaths(
          tx,
          subtreeMove.oldPrefix,
          subtreeMove.newPrefix,
          subtreeMove.depthDelta,
        );
      }

      return row;
    });

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

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid category id", 400);

    const [category] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!category) return jsonError("Category not found", 404);

    if (await hasChildren(id)) {
      // ON DELETE RESTRICT would raise this as a 500 from the driver. Answering 409 with
      // an instruction is the difference between a bug report and a usable API.
      return jsonError("Delete or move this category's subcategories first", 409);
    }

    await db.delete(categories).where(eq(categories.id, id));

    return jsonOk({ message: "Category deleted successfully" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/categories/[id]]", err);
    return jsonError("Internal server error");
  }
}
