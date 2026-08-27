import { NextRequest, NextResponse } from "next/server";

import { getOAuthProvider, redirectUriFor } from "@/lib/oauth/registry";
import { safeReturnTo } from "@/lib/oauth/return-to";
import {
  OAUTH_TX_COOKIE,
  oauthTxCookieOptions,
  sealTransaction,
} from "@/lib/oauth/state";
import {
  OAUTH_INITIATE_RATE_LIMIT,
  getClientIp,
  rateLimit,
} from "@/lib/rate-limit";
import { jsonError } from "@/lib/response";

/**
 * @swagger
 * /api/auth/oauth/{provider}:
 *   get:
 *     tags: [Auth]
 *     summary: Start an OAuth2 sign-in
 *     description: >
 *       Redirects to the provider's authorization endpoint and stores the transaction
 *       (state, PKCE verifier, nonce, returnTo) in a short-lived signed cookie.
 *       Google receives a PKCE challenge; GitHub OAuth Apps do not support PKCE and
 *       receive `state` only.
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [google, github] }
 *       - in: query
 *         name: returnTo
 *         required: false
 *         schema: { type: string }
 *         description: Same-site path to land on after signing in. External origins are ignored.
 *     responses:
 *       302:
 *         description: Redirect to the provider
 *       404:
 *         description: Unknown or unconfigured provider
 *       429:
 *         description: Too many attempts from this IP
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const limit = rateLimit(
      `oauth-initiate:${getClientIp(request)}`,
      OAUTH_INITIATE_RATE_LIMIT,
    );
    if (!limit.allowed) {
      return jsonError("Too many sign-in attempts. Please try again later.", 429, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    const { provider: name } = await params;
    const provider = getOAuthProvider(name);

    // Unknown and unconfigured are the same answer on purpose: which providers a
    // deployment has credentials for is not worth disclosing.
    if (!provider) return jsonError("Unknown provider", 404);

    const authorization = provider.getAuthorizationUrl({
      redirectUri: redirectUriFor(provider.id),
    });

    const response = NextResponse.redirect(authorization.url, 302);

    // Everything the callback needs travels in the signed cookie, never in the URL --
    // the provider echoes back only `state`, and the verifier must not be guessable
    // from anything the user agent exposes.
    response.cookies.set(
      OAUTH_TX_COOKIE,
      sealTransaction({
        provider: provider.id,
        state: authorization.state,
        codeVerifier: authorization.codeVerifier,
        nonce: authorization.nonce,
        returnTo: safeReturnTo(request.nextUrl.searchParams.get("returnTo")),
      }),
      oauthTxCookieOptions(),
    );

    return response;
  } catch (err) {
    console.error("[GET /api/auth/oauth/[provider]]", err);
    return jsonError("Internal server error", 500);
  }
}
