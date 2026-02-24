import { NextRequest } from "next/server";
import { authenticate, AuthError } from "@/lib/middleware";
import { jsonError, jsonOk } from "@/lib/response";

// JWTs are stateless — the canonical logout is client-side token discard.
// This endpoint authenticates the request (so an invalid/expired token gets a
// 401) and returns a confirmation the client should use to clear its stored token.
//
// To add server-side blocklisting (e.g. Redis TTL = remaining token lifetime),
// insert the jti/sub + exp into the blocklist here, then check it in authenticate().

export async function POST(request: NextRequest) {
  try {
    const payload = authenticate(request);
    // Placeholder for server-side blocklist:
    // await blocklist.add(payload.sub, payload.exp);

    return jsonOk({
      message: "Logged out successfully",
      hint: "Discard the token on the client side",
      sub: payload.sub,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[POST /api/auth/logout]", err);
    return jsonError("Internal server error", 500);
  }
}
