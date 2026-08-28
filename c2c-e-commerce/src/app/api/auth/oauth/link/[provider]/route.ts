import { and, count, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import { oauthAccounts, users } from "@/db/schema";
import { AuthError, authenticate } from "@/lib/middleware";
import { jsonError, jsonOk } from "@/lib/response";

/**
 * @swagger
 * /api/auth/oauth/link/{provider}:
 *   delete:
 *     tags: [Auth]
 *     summary: Detach an external identity
 *     description: >
 *       Removes the caller's link to a provider. Refuses when it is the caller's last
 *       remaining credential -- an OAuth-only account unlinking its only provider would
 *       have no way back in.
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [google, github] }
 *     responses:
 *       200: { description: Unlinked }
 *       401: { description: Not authenticated }
 *       404: { description: No such link for this user }
 *       409: { description: Would remove the caller's last credential }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const payload = authenticate(request);
    const { provider } = await params;

    if (provider !== "google" && provider !== "github") {
      return jsonError("Link not found", 404);
    }

    const [link] = await db
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.userId, payload.sub),
          eq(oauthAccounts.provider, provider),
        ),
      )
      .limit(1);

    // 404 rather than 403 when it belongs to someone else: whether another account has
    // that provider linked is not this caller's business, and 403 would confirm it.
    if (!link) return jsonError("Link not found", 404);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user) return jsonError("User not found", 404);

    const [{ total }] = await db
      .select({ total: count() })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, payload.sub));

    // The last-credential guard. Without it a passwordless user can lock themselves
    // out permanently, and there is no recovery flow to put them back.
    if (user.passwordHash === null && total <= 1) {
      return jsonError(
        "Set a password before unlinking your only sign-in method",
        409,
      );
    }

    await db.delete(oauthAccounts).where(eq(oauthAccounts.id, link.id));

    return jsonOk({ message: "Provider unlinked", provider });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/auth/oauth/link/[provider]]", err);
    return jsonError("Internal server error", 500);
  }
}
