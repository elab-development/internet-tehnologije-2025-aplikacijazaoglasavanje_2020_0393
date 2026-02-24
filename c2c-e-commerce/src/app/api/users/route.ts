import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { sanitizeUser } from "@/lib/auth";
import { jsonOk, jsonError } from "@/lib/response";

// ─── GET /api/users ───────────────────────────────────────────────────────────
// Admin only. Returns all users (without passwordHash).

export async function GET(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("admin")(payload);

    const rows = await db.select().from(users).orderBy(users.createdAt);

    return jsonOk(rows.map(sanitizeUser));
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/users]", err);
    return jsonError("Internal server error");
  }
}
