/**
 * C2C-AI-9 spec — GET /api/listings/[id]/similar.
 *
 * Item-to-item recommendations that need no user history at all, so they work from a
 * visitor's first page view. Built on the fixture catalogue, whose clusters are what make
 * "similar" assertable rather than a coin flip.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import { listings } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeCategory, makeListing, makeUser } from "@/test/factories";
import {
  loadSemanticCatalogue,
  type CatalogueEntry,
} from "@/test/fixtures/semantic-catalogue";

type Row = { id: number; title: string; status: string; similarity: number; categoryId: number | null };

async function similar(
  id: number | string,
  query = "",
  headers?: Record<string, string>,
): Promise<{ status: number; body: Row[] | { error?: string } }> {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/listings/${id}/similar?${query}`, { headers }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: await response.json() };
}

let catalogue: CatalogueEntry[];
const cycling = () => catalogue.filter((e) => e.cluster === "cycling");

beforeEach(async () => {
  await resetDb();
  catalogue = await loadSemanticCatalogue();
});

describe("C2C-AI-9 — AC1: nearest neighbours", () => {
  it("AC1: returns up to six similar listings by default", async () => {
    const { status, body } = await similar(cycling()[0].id);

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as Row[]).length).toBe(6);
  });

  it("AC1: they are ordered by descending similarity", async () => {
    const { body } = await similar(cycling()[0].id);
    const scores = (body as Row[]).map((row) => row.similarity);

    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("AC1: every row carries a similarity between 0 and 1", async () => {
    const { body } = await similar(cycling()[0].id);

    for (const row of body as Row[]) {
      expect(row.similarity).toBeGreaterThan(0);
      expect(row.similarity).toBeLessThanOrEqual(1);
    }
  });

  it("AC1: what comes back is genuinely related, not merely the first six rows", async () => {
    // The criterion that matters. A query returning any six active listings would satisfy
    // a count check and be worthless as a recommendation.
    const source = cycling()[0];
    const { body } = await similar(source.id);

    const cyclingIds = new Set(cycling().map((e) => e.id));
    for (const row of body as Row[]) {
      expect(cyclingIds.has(row.id)).toBe(true);
    }
  });

  it("AC1: an explicit limit is honoured", async () => {
    const { body } = await similar(cycling()[0].id, "limit=3");
    expect((body as Row[]).length).toBe(3);
  });

  it("AC1: rows carry enough to render a card", async () => {
    const { body } = await similar(cycling()[0].id);
    const [row] = body as Row[];

    expect(row).toMatchObject({
      id: expect.any(Number),
      title: expect.any(String),
    });
  });
});

describe("C2C-AI-9 — AC2/AC3: what must never appear", () => {
  it("AC2: the source listing never appears in its own results", async () => {
    const source = cycling()[0];
    const { body } = await similar(source.id);

    expect((body as Row[]).map((row) => row.id)).not.toContain(source.id);
  });

  it("AC2: it is excluded even when a large limit would otherwise reach it", async () => {
    const source = cycling()[0];
    const { body } = await similar(source.id, "limit=20");

    expect((body as Row[]).map((row) => row.id)).not.toContain(source.id);
  });

  it("AC3: sold and removed listings never appear", async () => {
    const db = await getTestDb();
    const source = cycling()[0];
    const neighbour = cycling()[1];

    await db
      .update(listings)
      .set({ status: "sold" })
      .where(eq(listings.id, neighbour.id));

    const { body } = await similar(source.id, "limit=20");

    // Recommending an unavailable item is worse than recommending nothing.
    expect((body as Row[]).map((row) => row.id)).not.toContain(neighbour.id);
    for (const row of body as Row[]) {
      expect(row.status).toBe("active");
    }
  });

  it("AC3: a removed listing is excluded too", async () => {
    const db = await getTestDb();
    const source = cycling()[0];
    const neighbour = cycling()[2];

    await db
      .update(listings)
      .set({ status: "removed" })
      .where(eq(listings.id, neighbour.id));

    const { body } = await similar(source.id, "limit=20");
    expect((body as Row[]).map((row) => row.id)).not.toContain(neighbour.id);
  });

  it("AC3: listings without an embedding are excluded, since they cannot be ranked", async () => {
    const seller = await makeUser({ role: "seller" });
    await makeListing({ sellerId: seller.id, title: "Bike with no vector" });

    const { body } = await similar(cycling()[0].id, "limit=20");
    expect((body as Row[]).map((row) => row.title)).not.toContain("Bike with no vector");
  });
});

describe("C2C-AI-9 — AC4/AC5: edge cases that must not be 500s", () => {
  it("AC4: a listing with no embedding answers 200 and an empty array", async () => {
    const seller = await makeUser({ role: "seller" });
    const unembedded = await makeListing({ sellerId: seller.id, title: "No vector here" });

    const { status, body } = await similar(unembedded.id);

    // Not a 500: having no vector is an ordinary state, and AI-4 AC2 makes it reachable
    // through the normal write path whenever the embedder fails.
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("AC5: a non-existent listing id answers 404", async () => {
    const { status } = await similar(999_999);
    expect(status).toBe(404);
  });

  it("AC5: a non-numeric id answers 400 rather than 404 or 500", async () => {
    const { status } = await similar("not-a-number");
    expect(status).toBe(400);
  });

  it("AC4: a catalogue where nothing else is active answers an empty array", async () => {
    const db = await getTestDb();
    const source = cycling()[0];

    await db.update(listings).set({ status: "sold" });
    await db
      .update(listings)
      .set({ status: "active" })
      .where(eq(listings.id, source.id));

    const { status, body } = await similar(source.id);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("C2C-AI-9 — AC6: the limit is capped", () => {
  it("AC6: limit=999 returns at most 20", async () => {
    const { body } = await similar(cycling()[0].id, "limit=999");
    expect((body as Row[]).length).toBeLessThanOrEqual(20);
  });

  it("AC6: a limit of zero or below falls back to the default rather than returning nothing", async () => {
    for (const limit of ["0", "-5"]) {
      const { body } = await similar(cycling()[0].id, `limit=${limit}`);
      expect((body as Row[]).length).toBeGreaterThan(0);
    }
  });

  it("AC6: a non-numeric limit falls back to the default", async () => {
    const { body } = await similar(cycling()[0].id, "limit=lots");
    expect((body as Row[]).length).toBe(6);
  });
});

describe("C2C-AI-9 — AC7: sameCategoryOnly", () => {
  it("AC7: every returned listing shares the source's category", async () => {
    const db = await getTestDb();
    const source = cycling()[0];
    const [sourceRow] = await db.select().from(listings).where(eq(listings.id, source.id));

    const { body } = await similar(source.id, "sameCategoryOnly=true&limit=20");

    expect((body as Row[]).length).toBeGreaterThan(0);
    for (const row of body as Row[]) {
      expect(row.categoryId).toBe(sourceRow.categoryId);
    }
  });

  it("AC7: without it, listings from other categories may appear", async () => {
    // A positive control: with the filter off the endpoint is not silently applying it.
    const db = await getTestDb();
    const source = cycling()[0];
    const [sourceRow] = await db.select().from(listings).where(eq(listings.id, source.id));

    const { body } = await similar(source.id, "limit=20");
    const categories = new Set((body as Row[]).map((row) => row.categoryId));

    expect(categories.size).toBeGreaterThan(1);
    expect(categories.has(sourceRow.categoryId)).toBe(true);
  });

  it("AC7: a source listing with no category returns an empty array under the filter", async () => {
    const seller = await makeUser({ role: "seller" });
    const orphan = await makeListing({
      sellerId: seller.id,
      categoryId: null,
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)),
    });

    const { status, body } = await similar(orphan.id, "sameCategoryOnly=true");
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("AC7: sameCategoryOnly=false behaves as if it were absent", async () => {
    const withFalse = await similar(cycling()[0].id, "sameCategoryOnly=false&limit=20");
    const without = await similar(cycling()[0].id, "limit=20");

    expect((withFalse.body as Row[]).map((r) => r.id)).toEqual(
      (without.body as Row[]).map((r) => r.id),
    );
  });
});

describe("C2C-AI-9 — the endpoint is public", () => {
  it("an anonymous caller gets results without any credentials", async () => {
    const { status, body } = await similar(cycling()[0].id);

    expect(status).toBe(200);
    expect((body as Row[]).length).toBeGreaterThan(0);
  });

  it("a sold source listing still yields recommendations", async () => {
    // Someone arriving from a stale link should still be offered alternatives — that is
    // the most useful moment for this endpoint.
    const db = await getTestDb();
    const source = cycling()[0];
    await db.update(listings).set({ status: "sold" }).where(eq(listings.id, source.id));

    const { status, body } = await similar(source.id);
    expect(status).toBe(200);
    expect((body as Row[]).length).toBeGreaterThan(0);
  });
});

describe("C2C-AI-9 — a category with a single member", () => {
  it("AC7: returns an empty array rather than erroring", async () => {
    const seller = await makeUser({ role: "seller" });
    const lonely = await makeCategory({ name: "Lonely", slug: "lonely" });
    const only = await makeListing({
      sellerId: seller.id,
      categoryId: lonely.id,
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 5 ? 1 : 0)),
    });

    const { status, body } = await similar(only.id, "sameCategoryOnly=true");
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("draft visibility", () => {
  // A 200 with neighbours confirms the listing exists and describes what it is about
  // through the things nearest it in vector space -- for a listing its owner has not
  // published.
  it("answers 404 for a stranger asking about a draft", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "draft" });

    const { status } = await similar(listing.id);

    expect(status).toBe(404);
  });

  it("answers 404 for a signed-in stranger too", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "draft" });
    const stranger = await makeUser({ role: "buyer" });

    const { status } = await similar(listing.id, "", authHeaderFor(stranger));

    expect(status).toBe(404);
  });

  it("serves the owner their own draft's neighbours", async () => {
    // The positive control: a handler that 404s on every draft would pass both
    // assertions above while breaking the feature for the person it belongs to.
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "draft" });

    const { status } = await similar(listing.id, "", authHeaderFor(seller));

    expect(status).toBe(200);
  });

  it("serves an admin the same", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "draft" });
    const admin = await makeUser({ role: "admin" });

    const { status } = await similar(listing.id, "", authHeaderFor(admin));

    expect(status).toBe(200);
  });

  it("still serves a published listing to anyone", async () => {
    const listing = await makeListing({ status: "active" });

    const { status } = await similar(listing.id);

    expect(status).toBe(200);
  });
});
