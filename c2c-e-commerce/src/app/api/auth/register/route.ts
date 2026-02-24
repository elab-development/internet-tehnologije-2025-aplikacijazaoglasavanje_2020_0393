import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, signToken, sanitizeUser } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/response";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return jsonError(
        "Invalid request body",
        400 );
    }

    const { email, password, name, role = "buyer" } = body as Record<string, unknown>;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!email || typeof email !== "string") {
      return jsonError(
        "email is required",
        400
      );
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return jsonError(
        "password is required and must be at least 8 characters",
         400
      );
    }
    if (!name || typeof name !== "string") {
      return jsonError(
        "name is required", 
        400 
      );
    }
    if (role !== "buyer" && role !== "seller") {
      return jsonError(
        "role must be 'buyer' or 'seller'" ,
        400 
      );
    }

    // ── Uniqueness check ──────────────────────────────────────────────────────
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return jsonError(
        "An account with that email already exists",
        409
      );
    }

    // ── Create user ───────────────────────────────────────────────────────────
    const passwordHash = await hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name, role })
      .returning();

    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    return jsonOk({ user: sanitizeUser(user), token }, 201);
  } catch (err) {
    console.error("[POST /api/auth/register]", err);
    return jsonError("Internal server error");
  }
}
