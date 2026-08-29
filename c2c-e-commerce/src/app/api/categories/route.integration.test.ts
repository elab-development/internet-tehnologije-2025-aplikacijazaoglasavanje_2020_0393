/**
 * Category-tree spec — POST /api/categories, exercised end to end.
 *
 * Task 1 made `path` NOT NULL with no default, which nothing here previously covered:
 * every existing category-route test asserted on validation or authorisation, never on
 * a successful create. Task 4 extends this file with `parentId` cases.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { authHeaderFor } from "@/test/auth";
import { resetDb } from "@/test/db";
import { makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function createCategory(headers: Record<string, string>, body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/categories", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/categories", () => {
  it("creates a root category, its own id as path, at depth 0", async () => {
    const admin = await makeUser({ role: "admin" });

    const response = await createCategory(authHeaderFor(admin), {
      name: "Electronics",
      slug: "electronics",
    });

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      id: number;
      path: string;
      depth: number;
      parentId: number | null;
    };
    expect(body.path).toBe(String(body.id));
    expect(body.depth).toBe(0);
    expect(body.parentId).toBeNull();
  });
});
