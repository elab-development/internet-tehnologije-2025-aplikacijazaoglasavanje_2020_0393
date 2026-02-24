import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { User } from "@/db/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = "7d";

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

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ─── Token helpers ────────────────────────────────────────────────────────────

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  return decoded as unknown as TokenPayload;
}

// ─── Sanitize user for API responses ─────────────────────────────────────────

export function sanitizeUser(user: User): Omit<User, "passwordHash"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _omit, ...safe } = user;
  return safe;
}
