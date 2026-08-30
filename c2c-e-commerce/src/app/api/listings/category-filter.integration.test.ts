/**
 * Part 1 spec — what `?categoryId=` means, and where a listing may be filed.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { signToken } from "@/lib/auth";
import { resetDb } from "@/test/db";
import { makeCategory, makeListing, makeUser } from "@/test/factories";

let sellerToken: string;
let sellerId: number;

beforeEach(async () => {
  await resetDb();
  const seller = await makeUser({ role: "seller" });
  sellerId = seller.id;
  sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
});

async function listByCategory(categoryId: number) {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/listings?categoryId=${categoryId}&limit=50`),
  );
  return (await response.json()) as { data: { id: number }[] };
}

async function createListing(categoryId: number) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/listings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        title: "A thing",
        description: "A description",
        price: 10,
        categoryId,
      }),
    }),
  );
}

describe("GET /api/listings?categoryId= — descendants included", () => {
  it("returns listings filed under a descendant when filtering by an ancestor", async () => {
    const electronics = await makeCategory({ slug: "electronics" });
    const phones = await makeCategory({ slug: "phones", parentId: electronics.id });
    const smartphones = await makeCategory({
      slug: "smartphones",
      parentId: phones.id,
    });

    const deep = await makeListing({ categoryId: smartphones.id, sellerId });

    const result = await listByCategory(electronics.id);

    expect(result.data.map((l) => l.id)).toContain(deep.id);
  });

  it("does not return listings from a sibling branch", async () => {
    const electronics = await makeCategory({ slug: "electronics" });
    const phones = await makeCategory({ slug: "phones", parentId: electronics.id });
    const clothing = await makeCategory({ slug: "clothing" });

    await makeListing({ categoryId: phones.id, sellerId });
    const unrelated = await makeListing({ categoryId: clothing.id, sellerId });

    const result = await listByCategory(electronics.id);

    expect(result.data.map((l) => l.id)).not.toContain(unrelated.id);
  });

  it("returns a leaf's own listings when filtering by that leaf", async () => {
    const root = await makeCategory();
    const leaf = await makeCategory({ parentId: root.id });
    const listing = await makeListing({ categoryId: leaf.id, sellerId });

    const result = await listByCategory(leaf.id);

    expect(result.data.map((l) => l.id)).toEqual([listing.id]);
  });
});

describe("POST /api/listings — leaf categories only", () => {
  it("accepts a leaf category", async () => {
    const root = await makeCategory();
    const leaf = await makeCategory({ parentId: root.id });

    const response = await createListing(leaf.id);

    expect(response.status).toBe(201);
  });

  it("rejects a category that has children", async () => {
    const root = await makeCategory();
    await makeCategory({ parentId: root.id });

    const response = await createListing(root.id);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Listings must be filed under a category with no subcategories",
    });
  });

  it("rejects an unknown category", async () => {
    const response = await createListing(999999);

    expect(response.status).toBe(400);
  });
});
