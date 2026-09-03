/**
 * Part 1 spec — the category tree's storage.
 *
 * Path and depth are the two things every later query trusts, so they are asserted
 * against the database rather than against the factory that wrote them.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { categories } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeCategory } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

describe("categories tree columns", () => {
  it("gives a root category its own id as its path, at depth 0", async () => {
    const root = await makeCategory({ name: "Electronics" });

    expect(root.parentId).toBeNull();
    expect(root.path).toBe(String(root.id));
    expect(root.depth).toBe(0);
  });

  it("gives a child the parent's path plus its own id, at depth 1", async () => {
    const root = await makeCategory({ name: "Electronics" });
    const child = await makeCategory({ name: "Phones", parentId: root.id });

    expect(child.parentId).toBe(root.id);
    expect(child.path).toBe(`${root.id}.${child.id}`);
    expect(child.depth).toBe(1);
  });

  it("gives a grandchild a three-segment path at depth 2", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });
    const grandchild = await makeCategory({ parentId: child.id });

    expect(grandchild.path).toBe(`${root.id}.${child.id}.${grandchild.id}`);
    expect(grandchild.depth).toBe(2);
  });

  it("refuses a fourth level at the database", async () => {
    const root = await makeCategory();
    const child = await makeCategory({ parentId: root.id });
    const grandchild = await makeCategory({ parentId: child.id });

    // The CHECK is the last line of defence behind the Zod and route checks. If it is
    // missing, a bug anywhere above it silently produces an unusable taxonomy.
    await expect(makeCategory({ parentId: grandchild.id })).rejects.toThrow();
  });

  it("refuses to delete a category that still has children", async () => {
    const db = await getTestDb();
    const root = await makeCategory();
    await makeCategory({ parentId: root.id });

    await expect(
      db.delete(categories).where(eq(categories.id, root.id)),
    ).rejects.toThrow();
  });
});
