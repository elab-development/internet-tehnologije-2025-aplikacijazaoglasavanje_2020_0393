import { describe, it, expect, vi } from "vitest";
import { AuthError, authenticate, authorize } from "./middleware";
import type { TokenPayload } from "@/lib/auth";

// Mock the auth module
vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === "valid-token") {
      return { sub: 1, email: "user@example.com", role: "buyer" } as TokenPayload;
    }
    if (token === "seller-token") {
      return { sub: 2, email: "seller@example.com", role: "seller" } as TokenPayload;
    }
    if (token === "admin-token") {
      return { sub: 3, email: "admin@example.com", role: "admin" } as TokenPayload;
    }
    throw new Error("Invalid token");
  }),
}));

// Minimal NextRequest mock
function createMockRequest(authHeader?: string) {
  return {
    headers: {
      get: (name: string) => {
        if (name === "authorization") return authHeader ?? null;
        return null;
      },
    },
  } as unknown as import("next/server").NextRequest;
}

// ─── AuthError ────────────────────────────────────────────────────────────────

describe("AuthError", () => {
  it("should be an instance of Error", () => {
    const err = new AuthError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AuthError");
  });

  it("should default statusCode to 401", () => {
    const err = new AuthError("unauthorized");
    expect(err.statusCode).toBe(401);
  });

  it("should accept custom statusCode", () => {
    const err = new AuthError("forbidden", 403);
    expect(err.statusCode).toBe(403);
  });
});

// ─── authenticate ─────────────────────────────────────────────────────────────

describe("authenticate", () => {
  it("returns payload for valid bearer token", () => {
    const req = createMockRequest("Bearer valid-token");
    const payload = authenticate(req);
    expect(payload).toEqual({
      sub: 1,
      email: "user@example.com",
      role: "buyer",
    });
  });

  it("throws AuthError when no authorization header", () => {
    const req = createMockRequest();
    expect(() => authenticate(req)).toThrow(AuthError);
  });

  it("throws AuthError for non-Bearer scheme", () => {
    const req = createMockRequest("Basic dXNlcjpwYXNz");
    expect(() => authenticate(req)).toThrow(AuthError);
  });

  it("throws AuthError for invalid token", () => {
    const req = createMockRequest("Bearer invalid-token");
    expect(() => authenticate(req)).toThrow(AuthError);
  });
});

// ─── authorize ────────────────────────────────────────────────────────────────

describe("authorize", () => {
  it("does not throw when role matches", () => {
    const guard = authorize("buyer");
    const payload: TokenPayload = {
      sub: 1,
      email: "user@example.com",
      role: "buyer",
    };
    expect(() => guard(payload)).not.toThrow();
  });

  it("does not throw when role is one of allowed roles", () => {
    const guard = authorize("admin", "seller");
    const payload: TokenPayload = {
      sub: 2,
      email: "seller@example.com",
      role: "seller",
    };
    expect(() => guard(payload)).not.toThrow();
  });

  it("throws AuthError with 403 when role is not allowed", () => {
    const guard = authorize("admin");
    const payload: TokenPayload = {
      sub: 1,
      email: "user@example.com",
      role: "buyer",
    };
    expect(() => guard(payload)).toThrow(AuthError);
    try {
      guard(payload);
    } catch (err) {
      expect((err as AuthError).statusCode).toBe(403);
    }
  });
});
