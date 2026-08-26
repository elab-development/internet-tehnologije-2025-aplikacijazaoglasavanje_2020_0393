/**
 * C2C-QA-3 — auth helper for tests.
 */
import { signToken } from "@/lib/auth";
import type { User } from "@/db/schema";

/**
 * A request header that authenticates as `user`.
 *
 * Signed with the application's own `signToken`, deliberately. A hand-rolled JWT here
 * would let tests pass while the production `authenticate()` guard rejected the token —
 * the one failure AC6 exists to catch.
 */
export function authHeaderFor(user: User): Record<string, string> {
  return {
    Authorization: `Bearer ${signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    })}`,
  };
}
