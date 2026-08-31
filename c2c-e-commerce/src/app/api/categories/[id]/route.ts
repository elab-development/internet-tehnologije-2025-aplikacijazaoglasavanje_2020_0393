import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import {
  findCategoryById,
  hasChildren,
  hasListings,
  rewriteSubtreePaths,
  subtreeHeight,
} from "@/db/categories";
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

// ─── Re-parenting guard errors ─────────────────────────────────────────────────
// Each is thrown from inside the transaction that now holds the row lock, rather than
// returned: a `return` in a Drizzle transaction callback commits it, and a rejected move
// must never commit whatever the callback had already written.

/** `parentId` names the node being moved itself. */
class SelfParentError extends Error {}
/** `parentId` does not name an existing category. */
class ParentNotFoundError extends Error {}
/** The prospective parent lies inside the node's own subtree. */
class CycleError extends Error {}
/** The subtree being moved would land a leaf past `MAX_CATEGORY_DEPTH`. */
class DepthExceededError extends Error {}
/** The prospective parent already carries a listing directly (D12). */
class CategoryHasListingsError extends Error {}
/** The node itself was deleted between the pre-lock read and the lock. */
class CategoryGoneMidMove extends Error {}

// ─── PATCH /api/categories/[id] ───────────────────────────────────────────────
// Admin only.

/**
 * @swagger
 * /api/categories/{id}:
 *   patch:
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
export async function PATCH(request: NextRequest, { params }: RouteContext) {
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
    //
    // Every guard below used to run on the module-level `db`, before this transaction
    // opened, so two simultaneous moves could each validate against paths the other was
    // about to invalidate -- and a cycle in a materialised-path tree is not cosmetic:
    // descendant queries stop terminating, and there is no constraint that would catch
    // it. They run inside the transaction now, under a row lock taken first, and each
    // early exit is a thrown typed error rather than a `return`: a `return` inside a
    // Drizzle transaction callback commits it, and a rejected move must never commit
    // whatever the callback had already written.
    const updated = await db.transaction(async (tx) => {
      let subtreeMove: { oldPrefix: string; newPrefix: string; depthDelta: number } | null =
        null;

      if (parentId !== undefined) {
        // Lock the node and its prospective parent before any guard reads a path. The
        // checks below are only meaningful against a tree that cannot change underneath
        // them, and a cycle is not something the schema can refuse on their behalf.
        //
        // Ordered by id so two concurrent moves of the same pair take the locks in the
        // same sequence and one waits rather than both deadlocking. De-duplicated so a
        // self-move (parentId === id, rejected below) does not lock the same row twice.
        const rawLockIds = [id, parentId].filter((value): value is number => value !== null);
        const lockIds = [...new Set(rawLockIds)].sort((a, b) => a - b);

        await tx
          .select({ id: categories.id })
          .from(categories)
          .where(inArray(categories.id, lockIds))
          .for("update");

        // Re-read the node itself now that its row is locked. The pre-lock read above
        // (`category`) is fine for the existence/404 gate, but two concurrent moves of
        // the *same* node both pass that gate before either lock is granted -- by the
        // time this one is, a concurrent move may already have committed a new path and
        // depth for it. Using the stale pre-lock values below would compute `oldPrefix`
        // and `depthDelta` from a prefix no row carries any more: `rewriteSubtreePaths`
        // would then LIKE-match nothing, silently rewrite zero descendant rows, and leave
        // them holding paths that disagree with the tree -- the exact failure a
        // materialised-path design cannot detect on its own.
        const locked = await findCategoryById(id, tx);
        if (!locked) throw new CategoryGoneMidMove();

        let newParentPath: string | null = null;

        if (parentId !== null) {
          if (parentId === id) {
            throw new SelfParentError();
          }

          const parent = await findCategoryById(parentId, tx);
          if (!parent) throw new ParentNotFoundError();

          if (wouldCreateCycle(locked.path, parent.path)) {
            throw new CycleError();
          }

          // The subtree travels with the node, so the cap applies to its deepest leaf,
          // not just to the node being moved.
          const height = await subtreeHeight(locked.path, tx);
          if (parent.depth + 1 + height > MAX_CATEGORY_DEPTH - 1) {
            throw new DepthExceededError();
          }

          // Re-parenting under a category that already carries listings gives it a child
          // just as surely as creating one there would, and strands those listings on a
          // now-non-leaf node (D12).
          if (await hasListings(parentId, tx)) {
            throw new CategoryHasListingsError();
          }

          newParentPath = parent.path;
        }

        const newPath = childPath(newParentPath, id);
        const newDepth = newParentPath === null ? 0 : depthOfPath(newParentPath) + 1;

        updates.parentId = parentId;
        updates.path = newPath;
        updates.depth = newDepth;

        subtreeMove = {
          oldPrefix: locked.path,
          newPrefix: newPath,
          depthDelta: newDepth - locked.depth,
        };
      }

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
    if (err instanceof SelfParentError || err instanceof CycleError) {
      return jsonError("A category cannot be moved under its own descendant", 400);
    }
    if (err instanceof ParentNotFoundError) return jsonError("Parent category not found", 400);
    if (err instanceof DepthExceededError) {
      return jsonError(
        `Categories may be nested at most ${MAX_CATEGORY_DEPTH} levels deep`,
        400,
      );
    }
    if (err instanceof CategoryHasListingsError) {
      return jsonError("Move this category's listings before giving it subcategories", 409);
    }
    if (err instanceof CategoryGoneMidMove) return jsonError("Category not found", 404);
    console.error("[PATCH /api/categories/[id]]", err);
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
