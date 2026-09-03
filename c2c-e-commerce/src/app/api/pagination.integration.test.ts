/**
 * Three admin collections returned whole tables, while two sibling collections paginated
 * properly. And browse ordering had no tiebreaker, so a row could fall between pages.
 */
import { inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { listings } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

type Page = { data: { id: number }[]; total: number; page: number; limit: number; totalPages: number };

async function ordersGet(headers: Record<string, string>, page: number, limit: number) {
  const { GET } = await import("./orders/route");
  return GET(
    new NextRequest(`http://localhost/api/orders?page=${page}&limit=${limit}`, { headers }),
  );
}

async function sellerOrdersGet(headers: Record<string, string>, page: number, limit: number) {
  const { GET } = await import("./orders/seller/route");
  return GET(
    new NextRequest(`http://localhost/api/orders/seller?page=${page}&limit=${limit}`, {
      headers,
    }),
  );
}

async function usersGet(headers: Record<string, string>, page: number, limit: number) {
  const { GET } = await import("./users/route");
  return GET(
    new NextRequest(`http://localhost/api/users?page=${page}&limit=${limit}`, { headers }),
  );
}

async function listingsGet(page: number, limit: number, sort: string) {
  const { GET } = await import("./listings/route");
  return GET(
    new NextRequest(`http://localhost/api/listings?page=${page}&limit=${limit}&sort=${sort}`),
  );
}

describe("admin collections paginate", () => {
  it.each([
    [
      "GET /api/orders",
      ordersGet,
      // Admins see every order (own scoping is exercised elsewhere), so 25 orders --
      // regardless of buyer -- is 25 rows for this caller.
      () => Promise.all(Array.from({ length: 25 }, () => makeOrder())),
    ],
    [
      "GET /api/orders/seller",
      sellerOrdersGet,
      () => Promise.all(Array.from({ length: 25 }, () => makeOrder())),
    ],
    [
      "GET /api/users",
      usersGet,
      // The admin caller is itself a user row, so 24 more makes 25.
      () => Promise.all(Array.from({ length: 24 }, () => makeUser())),
    ],
  ] as const)("%s honours page and limit", async (_label, call, seed) => {
    const admin = await makeUser({ role: "admin" });
    await seed();

    const first = (await (await call(authHeaderFor(admin), 1, 10)).json()) as Page;
    const second = (await (await call(authHeaderFor(admin), 2, 10)).json()) as Page;

    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(10);
    expect(first.total).toBe(25);
    expect(first.totalPages).toBe(3);

    // No row may appear on both pages.
    const firstIds = new Set(first.data.map((row) => row.id));
    expect(second.data.some((row) => firstIds.has(row.id))).toBe(false);
  });
});

describe("browse pagination is stable", () => {
  it("serves every listing exactly once across pages when timestamps collide", async () => {
    // All 15 share one createdAt, which is the case the missing tiebreaker broke.
    const created = await Promise.all(Array.from({ length: 15 }, () => makeListing()));

    const db = await getTestDb();
    const sameInstant = new Date("2026-08-30T12:00:00.000Z");
    await db
      .update(listings)
      .set({ createdAt: sameInstant })
      .where(
        inArray(
          listings.id,
          created.map((row) => row.id),
        ),
      );

    const seen: number[] = [];
    for (const page of [1, 2, 3]) {
      const body = (await (await listingsGet(page, 5, "newest")).json()) as Page;
      seen.push(...body.data.map((row) => row.id));
    }

    expect(new Set(seen).size).toBe(15);
  });
});
