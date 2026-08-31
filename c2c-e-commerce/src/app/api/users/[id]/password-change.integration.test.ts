/**
 * Changing a password is what a person does *after* they believe they were compromised.
 * Leaving the attacker's 30-day refresh token live makes the remediation theatre.
 *
 * Written against `PUT` — the handler's current export. Task 18 renames it to `PATCH`
 * and updates this file alongside it; do not rename it here.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import type { User } from "@/db/schema";
import { resetRateLimits } from "@/lib/rate-limit";
import { REFRESH_COOKIE } from "@/lib/refresh-cookies";
import { issueRefreshToken } from "@/lib/refresh-token";
import { authHeaderFor } from "@/test/auth";
import { resetDb } from "@/test/db";
import { makeUser } from "@/test/factories";

type SeededSession = { user: User; accessToken: string; refreshToken: string };

async function seedUserWithSession(password: string): Promise<SeededSession> {
  const user = await makeUser({ password });
  const { Authorization } = authHeaderFor(user);
  const { token: refreshToken } = await issueRefreshToken(user.id);

  return { user, accessToken: Authorization.replace(/^Bearer /, ""), refreshToken };
}

async function seedAdminWithSession(): Promise<{ user: User; accessToken: string }> {
  const user = await makeUser({ role: "admin" });
  const { Authorization } = authHeaderFor(user);

  return { user, accessToken: Authorization.replace(/^Bearer /, "") };
}

/** OAuth-only: `passwordHash` is null, so there is nothing to prove a current password against. */
async function seedOAuthOnlyUserWithSession(): Promise<{ user: User; accessToken: string }> {
  const user = await makeUser({ password: null });
  const { Authorization } = authHeaderFor(user);

  return { user, accessToken: Authorization.replace(/^Bearer /, "") };
}

function authed(accessToken: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/users/0", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
}

/** Presents a raw refresh token to `POST /api/auth/refresh`, the session an attacker would hold. */
async function refreshWith(rawToken: string) {
  const { POST } = await import("../../auth/refresh/route");
  return POST(
    new NextRequest("http://localhost/api/auth/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${REFRESH_COOKIE}=${rawToken}`,
      },
    }),
  );
}

async function loginStatus(email: string, password: string): Promise<number> {
  const { POST } = await import("../../auth/login/route");
  const response = await POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  return response.status;
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

describe("password change", () => {
  it("revokes every refresh family for that user", async () => {
    const { user, accessToken, refreshToken } = await seedUserWithSession("old-password-1");
    const { PUT } = await import("./route");

    const response = await PUT(
      authed(accessToken, {
        currentPassword: "old-password-1",
        password: "new-password-2",
      }),
      { params: Promise.resolve({ id: String(user.id) }) },
    );
    expect(response.status).toBe(200);

    // The session an attacker would still be holding must be dead.
    expect((await refreshWith(refreshToken)).status).toBe(401);
  });

  it("rejects a self-change that does not prove the current password", async () => {
    const { user, accessToken } = await seedUserWithSession("old-password-1");
    const { PUT } = await import("./route");

    const missing = await PUT(authed(accessToken, { password: "new-password-2" }), {
      params: Promise.resolve({ id: String(user.id) }),
    });
    expect(missing.status).toBe(400);

    const wrong = await PUT(
      authed(accessToken, {
        currentPassword: "not-the-password",
        password: "new-password-2",
      }),
      { params: Promise.resolve({ id: String(user.id) }) },
    );
    expect(wrong.status).toBe(403);

    // Positive control: after both rejections the old password must still work, so this
    // cannot pass against a handler that simply broke password changes altogether.
    expect(await loginStatus(user.email, "old-password-1")).toBe(200);
  });

  it("lets an admin reset another user's password without it", async () => {
    // An admin resetting a compromised account does not know the current password, and
    // demanding it would break the one case the reset exists for.
    const { user } = await seedUserWithSession("old-password-1");
    const admin = await seedAdminWithSession();
    const { PUT } = await import("./route");

    const response = await PUT(authed(admin.accessToken, { password: "reset-password-3" }), {
      params: Promise.resolve({ id: String(user.id) }),
    });

    expect(response.status).toBe(200);
    expect(await loginStatus(user.email, "reset-password-3")).toBe(200);
  });

  it("does not require a current password for an account that has none", async () => {
    // OAuth-only accounts have passwordHash null: there is nothing to verify against, and
    // setting a first password must stay possible.
    const { user, accessToken } = await seedOAuthOnlyUserWithSession();
    const { PUT } = await import("./route");

    const response = await PUT(authed(accessToken, { password: "first-password-1" }), {
      params: Promise.resolve({ id: String(user.id) }),
    });

    expect(response.status).toBe(200);
  });
});
