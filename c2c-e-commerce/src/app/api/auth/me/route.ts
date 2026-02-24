import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sanitizeUser } from "@/lib/auth";
import { authenticate, AuthError } from "@/lib/middleware";
import { jsonError, jsonOk } from "@/lib/response";

export async function GET(request: NextRequest) {
  try {
    const payload = authenticate(request);

    // Re-fetch from DB so the response always reflects the latest profile
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user) {
      return jsonError("User not found", 404);
    }

    return jsonOk({ user: sanitizeUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[GET /api/auth/me]", err);
    return jsonError("Internal server error", 500);
  }
}
