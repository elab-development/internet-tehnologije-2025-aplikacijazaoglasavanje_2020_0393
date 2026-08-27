import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { User } from "@/db/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

const SALT_ROUNDS = 12;
/**
 * Short by design (C2C-SEC-3). A stolen access token is only useful for this long;
 * continuity comes from the rotating refresh token instead. Must track
 * AUTH_COOKIE_MAX_AGE in lib/cookies.ts.
 */
const JWT_EXPIRES_IN = "15m";
/** Pinned so a forged header cannot talk us into a different algorithm. */
const JWT_ALGORITHM = "HS256" as const;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TokenPayload = {
  /** user id */
  sub: number;
  email: string;
  role: "buyer" | "seller" | "admin";
};

// ─── Password helpers ─────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * A real bcrypt hash of a value nothing can supply, used to burn the same CPU as a
 * genuine comparison when there is no hash to compare against.
 *
 * Generated once per process at 12 rounds -- the cost the application uses -- so the
 * decoy costs what the real thing costs.
 */
let decoyHash: string | null = null;

async function getDecoyHash(): Promise<string> {
  decoyHash ??= await bcrypt.hash(
    "password-that-belongs-to-no-account", SALT_ROUNDS
  );
  return decoyHash;
}

/**
 * Checks a password against a stored hash.
 *
 * `hash` is nullable because OAuth-only accounts have no password (C2C-SEC-5). The
 * naive handling -- return false immediately -- is correct on the answer and wrong on
 * the timing: bcrypt at 12 rounds costs hundreds of milliseconds, so an early return
 * makes those accounts answer visibly faster than password accounts. That gap is an
 * enumeration oracle, telling an attacker which addresses to attack through the
 * provider instead. So we compare against a decoy and discard the result.
 */
export async function verifyPassword(
  plain: string,
  hash: string | null
): Promise<boolean> {
  if (hash === null) {
    await bcrypt.compare(plain, await getDecoyHash());
    return false;
  }

  return bcrypt.compare(plain, hash);
}

// ─── Token helpers ────────────────────────────────────────────────────────────

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: JWT_ALGORITHM,
  });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: [JWT_ALGORITHM],
  });
  return decoded as unknown as TokenPayload;
}

// ─── Sanitize user for API responses ─────────────────────────────────────────

export function sanitizeUser(user: User): Omit<User, "passwordHash"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _omit, ...safe } = user;
  return safe;
}
