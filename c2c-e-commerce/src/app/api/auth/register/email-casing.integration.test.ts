/**
 * Registration used to store whatever casing the caller typed, so `A@x.com` and
 * `a@x.com` became two accounts. The OAuth callback then looked the user up with
 * `eq(users.email, profile.email)` and missed the existing one, quietly creating a
 * third. Separately, two simultaneous registrations of one address raced past the
 * pre-check and produced a 500 rather than a 409.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/register/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { resetRateLimits } from "@/lib/rate-limit";
import { resetDb } from "@/test/db";

const register = (email: string) =>
  POST(
    new NextRequest("http://test/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "correct-horse-battery",
        name: "Test Person",
      }),
    }),
  );

const login = (email: string, password: string) =>
  loginPOST(
    new NextRequest("http://test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );

describe("registration email casing", () => {
  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
  });

  it("stores the address lowercased", async () => {
    const response = await register("Seller@Example.TEST");
    expect(response.status).toBe(201);

    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("seller@example.test");
  });

  it("lets a user log in with the casing they originally typed", async () => {
    // The lockout this normalisation would otherwise cause: the column is lowercase, so a
    // lookup with the caller's original casing misses their own row and answers
    // "Invalid email or password" to a correct password.
    await register("Nikola@Example.TEST");

    const response = await login("Nikola@Example.TEST", "correct-horse-battery");
    expect(response.status).toBe(200);
  });

  it("refuses a second account differing only by case", async () => {
    expect((await register("seller@example.test")).status).toBe(201);

    const second = await register("SELLER@EXAMPLE.TEST");
    expect(second.status).toBe(409);

    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("answers 409, never 500, when two identical registrations race", async () => {
    // Both requests pass the pre-check before either insert lands. The unique index is
    // what actually decides, and the loser must be mapped to a conflict rather than
    // surfacing as an unhandled constraint violation.
    const [a, b] = await Promise.all([
      register("racer@example.test"),
      register("racer@example.test"),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    expect(await db.select().from(users)).toHaveLength(1);
  });
});
