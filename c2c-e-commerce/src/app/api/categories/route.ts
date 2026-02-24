import { NextRequest } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";
import { eq } from "drizzle-orm";

// ─── GET /api/categories ──────────────────────────────────────────────────────
// Public.

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

export async function POST(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("admin")(payload);

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);

    const { name, slug, description } = body as Record<string, unknown>;

    if (!name || typeof name !== "string" || !name.trim())
      return jsonError("name is required", 400);
    if (!slug || typeof slug !== "string" || !slug.trim())
      return jsonError("slug is required", 400);

    // check uniqueness
    const [existing] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, slug.trim()))
      .limit(1);
    if (existing) return jsonError("A category with that slug already exists", 409);

    const [created] = await db
      .insert(categories)
      .values({
        name: name.trim(),
        slug: slug.trim(),
        description: typeof description === "string" ? description.trim() : null,
      })
      .returning();

    return jsonOk(created, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[POST /api/categories]", err);
    return jsonError("Internal server error");
  }
}
