import { NextRequest } from "next/server";
import { verifyToken, type TokenPayload } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/cookies";

// ─── authenticate ─────────────────────────────────────────────────────────────
// Verifies the JWT carried either by the Authorization header (API clients,
// Swagger UI) or by the httpOnly auth cookie (browsers).
// Returns the decoded TokenPayload on success; throws a typed AuthError otherwise.

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403 = 401
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Reads the raw token from the request, preferring an explicit Authorization
 * header over the cookie: a caller that sets the header is stating which
 * identity it means to use, even in a browser that also holds a session cookie.
 */
function readToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const bearer = authHeader.slice(7).trim(); // strip "Bearer "
    if (bearer) return bearer;
  }

  return request.cookies?.get(AUTH_COOKIE)?.value ?? null;
}

export function authenticate(request: NextRequest): TokenPayload {
  const token = readToken(request);

  if (!token) {
    throw new AuthError("Missing authentication token");
  }

  try {
    return verifyToken(token);
  } catch {
    throw new AuthError("Invalid or expired token");
  }
}

// ─── authorize ────────────────────────────────────────────────────────────────
// Returns a guard function that asserts the payload's role is among allowedRoles.
// Usage:  const guard = authorize("admin", "seller");  guard(payload);

export function authorize(
  ...allowedRoles: TokenPayload["role"][]
): (payload: TokenPayload) => void {
  return (payload: TokenPayload) => {
    if (!allowedRoles.includes(payload.role)) {
      throw new AuthError(
        `Forbidden: requires role ${allowedRoles.join(" or ")}`,
        403
      );
    }
  };
}
