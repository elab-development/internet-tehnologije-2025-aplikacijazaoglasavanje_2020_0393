/**
 * Category-tree spec — POST /api/categories, exercised end to end.
 *
 * Task 1 made `path` NOT NULL with no default, which nothing here previously covered:
 * every existing category-route test asserted on validation or authorisation, never on
 * a successful create. Task 4 extends this file with `parentId` placement cases.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { signToken } from "@/lib/auth";
import { resetDb } from "@/test/db";
import { makeCategory, makeListing, makeUser } from "@/test/factories";

let adminToken: string;

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: "admin" });
  adminToken = signToken({ sub: admin.id, email: admin.email, role: admin.role });
});

async function createCategory(body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/categories", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/categories — tree placement", () => {
  it("creates a root with its own id as its path", async () => {
    const response = await createCategory({ name: "Electronics", slug: "electronics" });
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created.parentId).toBeNull();
    expect(created.path).toBe(String(created.id));
    expect(created.depth).toBe(0);
  });

  it("creates a child under its parent", async () => {
    const root = await makeCategory({ slug: "electronics" });

    const response = await createCategory({
      name: "Phones",
      slug: "phones",
      parentId: root.id,
    });
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created.path).toBe(`${root.id}.${created.id}`);
    expect(created.depth).toBe(1);
  });

  it("rejects an unknown parent with 400", async () => {
    const response = await createCategory({
      name: "Orphan",
      slug: "orphan",
      parentId: 999999,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Parent category not found",
    });
  });

  it("rejects a fourth level with 400 rather than letting the CHECK fire", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });
    const grandchild = await makeCategory({ parentId: child.id });

    const response = await createCategory({
      name: "Too deep",
      slug: "too-deep",
      parentId: grandchild.id,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Categories may be nested at most 3 levels deep",
    });
  });

  it("still rejects a duplicate slug with 409", async () => {
    await makeCategory({ slug: "electronics" });

    const response = await createCategory({ name: "Electronics", slug: "electronics" });

    expect(response.status).toBe(409);
  });

  it("refuses to give a category-with-listings a child, with 409", async () => {
    const electronics = await makeCategory({ slug: "electronics" });
    await makeListing({ categoryId: electronics.id });

    const response = await createCategory({
      name: "Phones",
      slug: "phones",
      parentId: electronics.id,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Move this category's listings before giving it subcategories",
    });
  });

  it("still allows a child under a parent with no listings", async () => {
    const electronics = await makeCategory({ slug: "electronics" });

    const response = await createCategory({
      name: "Phones",
      slug: "phones",
      parentId: electronics.id,
    });

    expect(response.status).toBe(201);
  });
});
