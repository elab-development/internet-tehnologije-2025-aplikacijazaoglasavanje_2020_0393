/**
 * C2C-QA-3 — auth helper for tests.
 *
 * SPEC PHASE SKELETON.
 */
import type { User } from "@/db/schema";

const NOT_IMPLEMENTED = "not implemented — C2C-QA-3 is in its spec phase";

/** A request header that authenticates as `user` against the real `authenticate()` guard. */
export function authHeaderFor(_user: User): Record<string, string> {
  throw new Error(NOT_IMPLEMENTED);
}
