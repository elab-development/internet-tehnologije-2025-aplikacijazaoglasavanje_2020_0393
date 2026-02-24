import { NextRequest } from "next/server";
import { verifyToken, type TokenPayload } from "@/lib/auth";

// ─── authenticate ─────────────────────────────────────────────────────────────
// Extracts and verifies the Bearer JWT from the Authorization header.
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

export function authenticate(request: NextRequest): TokenPayload {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7); // strip "Bearer "

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
