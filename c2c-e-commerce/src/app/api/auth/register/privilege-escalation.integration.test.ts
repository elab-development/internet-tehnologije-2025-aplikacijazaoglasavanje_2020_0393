/**
 * C2C-SEC-1 spec — self-registration privilege escalation (Bug).
 *
 * `POST /api/auth/register` once had its role whitelist commented out, so any anonymous
 * caller could mint an `admin` by posting `{"role":"admin"}`. The fix lives in
 * `RegisterBodySchema`, whose enum omits "admin" entirely.
 *
 * These are regression tests: they are written against a defect that is already closed,
 * so they pass on arrival. That makes them worthless unless they have been *observed*
 * failing — the guard was temporarily widened to `["buyer","seller","admin"]` while
 * writing them, and AC1 and AC2 went red (`expected 201 to be 400`, `expected 1 to be
 * +0`). Anyone weakening that enum again should expect the same two to fail.
 *
 * AC5 deliberately stays green under that mutation: it pins the *shape* of the guard —
 * an allowlist enum — rather than the single value "admin". A check written as
 * `role !== "admin"` would pass AC1 and AC2 and still fail AC5.
 *
 * The assertions deliberately check the **database**, not just the response code. A route
 * that returns 400 after having already inserted the row is still an escalation; only a
 * row count proves otherwise.
 */
import { count, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { users } from "@/db/schema";
import { resetRateLimits } from "@/lib/rate-limit";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeUser } from "@/test/factories";

type RegisterBody = {
  user?: { id: number; email: string; role: string };
  token?: string;
  error?: string;
};

/**
 * Each call gets a distinct IP: registration is rate-limited per client, and a shared
 * key would make the sixth test in a file fail for reasons that have nothing to do with
 * privilege escalation.
 */
let clientCounter = 0;

async function register(body: unknown): Promise<{ status: number; body: RegisterBody }> {
  const { POST } = await import("./route");
  clientCounter += 1;

  const response = await POST(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.0.0.${clientCounter}`,
      },
      body: JSON.stringify(body),
    }),
  );

  return { status: response.status, body: (await response.json()) as RegisterBody };
}

async function updateUser(
  id: number,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; body: { role?: string; error?: string } }> {
  const { PUT } = await import("../../users/[id]/route");

  const response = await PUT(
    new NextRequest(`http://localhost/api/users/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

  return { status: response.status, body: await response.json() };
}

/** How many `admin` rows exist right now. */
async function adminCount(): Promise<number> {
  const db = await getTestDb();
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.role, "admin"));
  return row.n;
}

const VALID = { email: "new@example.test", password: "password123", name: "New User" };

describe("C2C-SEC-1 — self-registration cannot escalate to admin", () => {
  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
  });

  it("AC1: registering with role 'admin' is rejected and creates no user row", async () => {
    const { status, body } = await register({ ...VALID, role: "admin" });

    expect(status).toBe(400);
    expect(body.user).toBeUndefined();
    expect(body.token).toBeUndefined();

    const db = await getTestDb();
    const rows = await db.select().from(users).where(eq(users.email, VALID.email));
    expect(rows).toHaveLength(0);
  });

  it("AC2: no admin exists after a rejected escalation attempt", async () => {
    expect(await adminCount()).toBe(0);

    await register({ ...VALID, role: "admin" });

    expect(await adminCount()).toBe(0);
  });

  it("AC3: registering as 'seller' succeeds", async () => {
    const { status, body } = await register({
      ...VALID,
      email: "seller@example.test",
      role: "seller",
    });

    expect(status).toBe(201);
    expect(body.user?.role).toBe("seller");
  });

  it("AC3: registering as 'buyer' succeeds", async () => {
    const { status, body } = await register({
      ...VALID,
      email: "buyer@example.test",
      role: "buyer",
    });

    expect(status).toBe(201);
    expect(body.user?.role).toBe("buyer");
  });

  it("AC4: omitting role defaults to buyer", async () => {
    const { status, body } = await register(VALID);

    expect(status).toBe(201);
    expect(body.user?.role).toBe("buyer");
  });

  it("AC5: an unknown role is rejected", async () => {
    const { status } = await register({ ...VALID, role: "superuser" });

    expect(status).toBe(400);
    expect(await adminCount()).toBe(0);
  });

  it("AC5: role must be a string from the enum, not an arbitrary type", async () => {
    // A schema that only checked `role !== "admin"` would let these through.
    for (const role of [["admin"], { role: "admin" }, 1, true]) {
      const { status } = await register({ ...VALID, role });
      expect(status).toBe(400);
    }

    expect(await adminCount()).toBe(0);
  });
});

describe("C2C-SEC-1 — PUT /api/users/[id] is the only path that grants admin", () => {
  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
  });

  it("AC6: an admin can promote another user to admin", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser({ role: "buyer" });

    const { status, body } = await updateUser(
      target.id,
      { role: "admin" },
      authHeaderFor(admin),
    );

    expect(status).toBe(200);
    expect(body.role).toBe("admin");
  });

  it("AC6: a non-admin promoting someone else is forbidden", async () => {
    const seller = await makeUser({ role: "seller" });
    const target = await makeUser({ role: "buyer" });

    const { status } = await updateUser(
      target.id,
      { role: "admin" },
      authHeaderFor(seller),
    );

    expect(status).toBe(403);
    expect(await adminCount()).toBe(0);
  });

  it("AC6: a user cannot promote themselves, even on their own record", async () => {
    // The ownership check passes here — `payload.sub === id` — so only the explicit
    // role guard stands between a buyer and an admin token.
    const buyer = await makeUser({ role: "buyer" });

    const { status } = await updateUser(
      buyer.id,
      { role: "admin" },
      authHeaderFor(buyer),
    );

    expect(status).toBe(403);
    expect(await adminCount()).toBe(0);
  });

  it("AC6: an unauthenticated caller cannot change a role", async () => {
    const target = await makeUser({ role: "buyer" });

    const { status } = await updateUser(target.id, { role: "admin" }, {});

    expect(status).toBe(401);
    expect(await adminCount()).toBe(0);
  });
});
