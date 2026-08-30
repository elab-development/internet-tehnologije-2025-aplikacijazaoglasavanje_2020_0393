/**
 * Part 1 spec — re-parenting and deleting inside a tree.
 *
 * The subtree rewrite is the part worth testing hardest: getting it wrong leaves rows
 * whose `path` disagrees with their `parentId`, and every descendant filter silently
 * returns the wrong listings from then on.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { categories } from "@/db/schema";
import { signToken } from "@/lib/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeCategory, makeUser } from "@/test/factories";

let adminToken: string;

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: "admin" });
  adminToken = signToken({ sub: admin.id, email: admin.email, role: admin.role });
});

async function updateCategory(id: number, body: unknown) {
  const { PUT } = await import("./route");
  return PUT(
    new NextRequest(`http://localhost/api/categories/${id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

async function deleteCategory(id: number) {
  const { DELETE } = await import("./route");
  return DELETE(
    new NextRequest(`http://localhost/api/categories/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${adminToken}` },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

async function row(id: number) {
  const db = await getTestDb();
  const [found] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return found;
}

describe("PUT /api/categories/[id] — re-parenting", () => {
  it("rewrites the moved node and its whole subtree", async () => {
    const electronics = await makeCategory({ slug: "electronics" });
    const phones = await makeCategory({ slug: "phones", parentId: electronics.id });
    const smartphones = await makeCategory({
      slug: "smartphones",
      parentId: phones.id,
    });
    const clothing = await makeCategory({ slug: "clothing" });

    const response = await updateCategory(phones.id, { parentId: clothing.id });

    expect(response.status).toBe(200);
    expect((await row(phones.id)).path).toBe(`${clothing.id}.${phones.id}`);
    expect((await row(smartphones.id)).path).toBe(
      `${clothing.id}.${phones.id}.${smartphones.id}`,
    );
    expect((await row(smartphones.id)).depth).toBe(2);
  });

  it("promotes a node to a root when parentId is explicitly null", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });

    const response = await updateCategory(child.id, { parentId: null });

    expect(response.status).toBe(200);
    expect((await row(child.id)).parentId).toBeNull();
    expect((await row(child.id)).path).toBe(String(child.id));
    expect((await row(child.id)).depth).toBe(0);
  });

  it("refuses to move a node under its own descendant", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });

    const response = await updateCategory(root.id, { parentId: child.id });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "A category cannot be moved under its own descendant",
    });
  });

  it("refuses a move that would push a descendant past the depth cap", async () => {
    const rootA = await makeCategory();
    const childA = await makeCategory({ parentId: rootA.id });
    // A two-level subtree cannot be hung under a node that is already at depth 1.
    const rootB = await makeCategory();
    const childB = await makeCategory({ parentId: rootB.id });
    await makeCategory({ parentId: childA.id });

    const response = await updateCategory(childA.id, { parentId: childB.id });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Categories may be nested at most 3 levels deep",
    });
  });

  it("leaves the parent alone when parentId is omitted", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });

    const response = await updateCategory(child.id, { name: "Renamed" });

    expect(response.status).toBe(200);
    expect((await row(child.id)).parentId).toBe(root.id);
    expect((await row(child.id)).path).toBe(`${root.id}.${child.id}`);
  });
});

describe("DELETE /api/categories/[id]", () => {
  it("refuses to delete a category that still has children", async () => {
    const root = await makeCategory();
    await makeCategory({ parentId: root.id });

    const response = await deleteCategory(root.id);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Delete or move this category's subcategories first",
    });
    expect(await row(root.id)).toBeDefined();
  });

  it("deletes a leaf", async () => {
    const leaf = await makeCategory();

    const response = await deleteCategory(leaf.id);

    expect(response.status).toBe(200);
    expect(await row(leaf.id)).toBeUndefined();
  });
});
