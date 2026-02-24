import { describe, it, expect, vi } from "vitest";
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  sanitizeUser,
  type TokenPayload,
} from "./auth";

// Set JWT_SECRET for tests
vi.stubEnv("JWT_SECRET", "test-jwt-secret-for-vitest");

// ─── Password helpers ─────────────────────────────────────────────────────────

describe("hashPassword / verifyPassword", () => {
  it("hashes a password and verifies it", async () => {
    const plain = "my-secure-password";
    const hash = await hashPassword(plain);
    expect(hash).not.toBe(plain);
    expect(await verifyPassword(plain, hash)).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct-password");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});

// ─── Token helpers ────────────────────────────────────────────────────────────

describe("signToken / verifyToken", () => {
  const payload: TokenPayload = {
    sub: 42,
    email: "test@example.com",
    role: "seller",
  };

  it("signs and verifies a token", () => {
    const token = signToken(payload);
    expect(typeof token).toBe("string");

    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(42);
    expect(decoded.email).toBe("test@example.com");
    expect(decoded.role).toBe("seller");
  });

  it("throws on invalid token", () => {
    expect(() => verifyToken("invalid.token.here")).toThrow();
  });
});

// ─── sanitizeUser ─────────────────────────────────────────────────────────────

describe("sanitizeUser", () => {
  it("removes passwordHash from user object", () => {
    const user = {
      id: 1,
      email: "user@example.com",
      passwordHash: "should-be-removed",
      name: "John",
      role: "buyer" as const,
      phoneNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const safe = sanitizeUser(user);
    expect(safe).not.toHaveProperty("passwordHash");
    expect(safe.id).toBe(1);
    expect(safe.email).toBe("user@example.com");
    expect(safe.name).toBe("John");
  });
});
