import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, signToken, sanitizeUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { email, password, name, role = "buyer" } = body as Record<string, unknown>;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "password is required and must be at least 8 characters" },
        { status: 400 }
      );
    }
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (role !== "buyer" && role !== "seller") {
      return NextResponse.json(
        { error: "role must be 'buyer' or 'seller'" },
        { status: 400 }
      );
    }

    // ── Uniqueness check ──────────────────────────────────────────────────────
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "An account with that email already exists" },
        { status: 409 }
      );
    }

    // ── Create user ───────────────────────────────────────────────────────────
    const passwordHash = await hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name, role })
      .returning();

    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    return NextResponse.json(
      { user: sanitizeUser(user), token },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/auth/register]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
