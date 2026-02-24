import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, signToken, sanitizeUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { email, password } = body as Record<string, unknown>;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "password is required" }, { status: 400 });
    }

    // ── Look up user ──────────────────────────────────────────────────────────
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Use a consistent error message to avoid user enumeration
    const invalidCredentials = NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );

    if (!user) return invalidCredentials;

    const passwordMatch = await verifyPassword(password, user.passwordHash);
    if (!passwordMatch) return invalidCredentials;

    // ── Issue token ───────────────────────────────────────────────────────────
    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    return NextResponse.json({ user: sanitizeUser(user), token });
  } catch (err) {
    console.error("[POST /api/auth/login]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
