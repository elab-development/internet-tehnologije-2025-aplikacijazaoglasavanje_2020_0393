import { NextRequest } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";
import { parseRequest, CreateCategorySchema } from "@/lib/validation";
import { eq } from "drizzle-orm";

// ─── GET /api/categories ──────────────────────────────────────────────────────
// Public.

/**
 * @swagger
 * /api/categories:
 *   get:
 *     tags: [Categories]
 *     summary: List all categories
 *     description: Returns all categories sorted alphabetically by name. Public endpoint.
 *     responses:
 *       200:
 *         description: Array of categories
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Category'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function GET() {
  try {
    const rows = await db.select().from(categories).orderBy(categories.name);
    return jsonOk(rows);
  } catch (err) {
    console.error("[GET /api/categories]", err);
    return jsonError("Internal server error");
  }
}

// ─── POST /api/categories ─────────────────────────────────────────────────────
// Admin only.
// Body: { name: string; slug: string; description?: string }

/**
 * @swagger
 * /api/categories:
 *   post:
 *     tags: [Categories]
 *     summary: Create a category
 *     description: Creates a new product category. Admin only.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Electronics
 *               slug:
 *                 type: string
 *                 example: electronics
 *               description:
 *                 type: string
 *                 nullable: true
 *                 example: Gadgets & devices
 *     responses:
 *       201:
 *         description: Category created
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
export async function POST(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("admin")(payload);

    const parsed = await parseRequest(request, CreateCategorySchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { name, slug, description } = parsed.data;

    // check uniqueness
    const [existing] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);
    if (existing) return jsonError("A category with that slug already exists", 409);

    // path is NOT NULL and derived from the row's own id, so it cannot be known before
    // the insert. Every category created through this route is a root for now — Task 4
    // adds parentId — so the path is just the id, set in a follow-up update inside the
    // same transaction as the insert.
    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(categories)
        .values({ name, slug, description: description ?? null, path: "" })
        .returning();

      const [withPath] = await tx
        .update(categories)
        .set({ path: String(inserted.id) })
        .where(eq(categories.id, inserted.id))
        .returning();

      return withPath;
    });

    return jsonOk(created, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[POST /api/categories]", err);
    return jsonError("Internal server error");
  }
}
