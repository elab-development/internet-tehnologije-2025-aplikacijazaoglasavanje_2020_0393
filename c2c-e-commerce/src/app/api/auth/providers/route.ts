import { availableProviders } from "@/lib/oauth/registry";
import { jsonError, jsonOk } from "@/lib/response";

/**
 * @swagger
 * /api/auth/providers:
 *   get:
 *     tags: [Auth]
 *     summary: Which OAuth2 providers this deployment offers
 *     description: >
 *       Public. The login page renders a button per entry, so a provider without
 *       credentials never shows a button that would 404. Returns only provider names --
 *       no client ids, no redirect URIs.
 *     responses:
 *       200:
 *         description: The configured providers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 providers:
 *                   type: array
 *                   items: { type: string, enum: [google, github] }
 */
export async function GET() {
  try {
    // Names only. A client id is not secret, but there is no reason for the browser to
    // hold one either -- the whole authorization URL is built server-side.
    return jsonOk({ providers: availableProviders() });
  } catch (err) {
    console.error("[GET /api/auth/providers]", err);
    return jsonError("Internal server error", 500);
  }
}
