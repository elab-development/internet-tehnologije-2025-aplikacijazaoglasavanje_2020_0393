/**
 * C2C-AI-7 spec — semantic and hybrid search on GET /api/listings.
 *
 * The main technical contribution: `search=warm jacket for winter` should surface a listing
 * the current `ilike` query cannot find.
 *
 * The embedding provider is replaced with one that maps a query into the fixture
 * catalogue's space. What is under test is the ranking, the fusion and the floor — not
 * whether MiniLM understands English, which AI-2's `embeddings.model.test.ts` already
 * checks against the real model.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeCategory, makeListing, makeUser } from "@/test/factories";
import {
  loadSemanticCatalogue,
  queryEmbedding,
  type CatalogueEntry,
} from "@/test/fixtures/semantic-catalogue";

/**
 * The query embedder, injected after imports settle.
 *
 * The mock factory must not import the fixtures module: that module imports
 * `@/lib/ai/embeddings` for EMBEDDING_DIMENSIONS, so importing it *from inside the factory
 * that is mocking that very module* deadlocks the worker. Assigning afterwards keeps the
 * factory dependency-free.
 */
const stub = vi.hoisted(() => ({
  embed: null as null | ((text: string) => number[]),
}));

vi.mock("@/lib/ai/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/embeddings")>();

  return {
    ...actual,
    getEmbeddingProvider: () => ({
      model: "fixture-query-embedder",
      warmup: async () => {},
      embed: async (text: string) => stub.embed!(text),
      embedBatch: async (texts: string[]) => texts.map((text) => stub.embed!(text)),
    }),
  };
});

stub.embed = queryEmbedding;

type Body = {
  data: { id: number; title: string; status: string; similarity?: number }[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

async function search(
  query: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Body }> {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/listings?${query}`, { headers }),
  );
  return { status: response.status, body: (await response.json()) as Body };
}

let catalogue: CatalogueEntry[];

beforeEach(async () => {
  await resetDb();
  catalogue = await loadSemanticCatalogue();
});

describe("C2C-AI-7 — AC1: keyword mode is unchanged", () => {
  it("AC1: omitting mode returns exactly what mode=keyword returns", async () => {
    const withoutMode = await search("search=bike");
    const explicit = await search("search=bike&mode=keyword");

    // Byte-identical, not merely equivalent: existing clients must see no difference.
    expect(JSON.stringify(withoutMode.body)).toBe(JSON.stringify(explicit.body));
  });

  it("AC1: keyword mode still matches on the title with ilike", async () => {
    const { body } = await search("search=bicycle");

    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row.title.toLowerCase()).toContain("bicycle");
    }
  });

  it("AC1: keyword mode adds no similarity field", async () => {
    const { body } = await search("search=bike");
    for (const row of body.data) {
      expect(row.similarity).toBeUndefined();
    }
  });

  it("AC1: the response keeps its pagination shape in every mode", async () => {
    for (const mode of ["keyword", "semantic", "hybrid"]) {
      const { body } = await search(`search=bike&mode=${mode}`);
      expect(body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
        page: 1,
        limit: 20,
        totalPages: expect.any(Number),
      });
    }
  });

  it("AC1: the default sort still applies when no search term is given", async () => {
    const { body } = await search("");
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.total).toBe(catalogue.length);
  });
});

describe("C2C-AI-7 — AC2/AC3: semantic mode", () => {
  it("AC2: finds listings by meaning where the keyword arm finds nothing", async () => {
    // "pedal" appears in no title in the catalogue, so ilike returns zero rows.
    const keyword = await search("search=pedal machine&mode=keyword");
    expect(keyword.body.total).toBe(0);

    const semantic = await search("search=pedal machine&mode=semantic");
    expect(semantic.body.data.length).toBeGreaterThan(0);
  });

  it("AC2: every returned row carries a similarity between 0 and 1", async () => {
    const { body } = await search("search=bike&mode=semantic");

    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row.similarity).toBeGreaterThan(0);
      expect(row.similarity).toBeLessThanOrEqual(1);
    }
  });

  it("AC2: what it finds is actually relevant, not merely non-empty", async () => {
    const { body } = await search("search=pedal machine&mode=semantic");

    const cyclingIds = new Set(
      catalogue.filter((e) => e.cluster === "cycling").map((e) => e.id),
    );
    for (const row of body.data) {
      expect(cyclingIds.has(row.id)).toBe(true);
    }
  });

  it("AC3: results are ordered by descending similarity", async () => {
    const { body } = await search("search=bike&mode=semantic&limit=10");

    const scores = body.data.map((row) => row.similarity!);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("AC4: a query unrelated to anything returns an empty set, not the least-bad rows", async () => {
    // Positive control: semantic mode does return things for a query that matches. Without
    // it, "returns nothing" would hold just as well against a mode that does nothing.
    const related = await search("search=pedal machine&mode=semantic");
    expect(related.body.total).toBeGreaterThan(0);

    const { body } = await search("search=quantum thermodynamics seminar&mode=semantic");

    // The floor holding. Without it the endpoint would always answer with *something*.
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.totalPages).toBe(0);
  });

  it("AC10: semantic mode with no search term falls back to keyword ordering", async () => {
    // Positive control: WITH a search term the two modes differ, so the equality below is
    // the fallback doing its job rather than semantic mode being ignored entirely.
    const withTerm = await search("search=pedal machine&mode=semantic");
    const keywordTerm = await search("search=pedal machine&mode=keyword");
    expect(withTerm.body.total).not.toBe(keywordTerm.body.total);

    const semantic = await search("mode=semantic");
    const keyword = await search("mode=keyword");

    // Embedding an empty string is meaningless; the endpoint must not do it.
    expect(semantic.body.data.map((r) => r.id)).toEqual(
      keyword.body.data.map((r) => r.id),
    );
    expect(semantic.body.total).toBe(keyword.body.total);
  });

  it("AC8: page 2 continues the ranking without repeating page 1", async () => {
    const first = await search("search=bike&mode=semantic&page=1&limit=3");
    const second = await search("search=bike&mode=semantic&page=2&limit=3");

    expect(first.body.data).toHaveLength(3);
    expect(second.body.data.length).toBeGreaterThan(0);
    // Both pages must be semantic results, not keyword ones paginated by accident.
    for (const row of [...first.body.data, ...second.body.data]) {
      expect(row.similarity).toEqual(expect.any(Number));
    }

    const firstIds = new Set(first.body.data.map((r) => r.id));
    for (const row of second.body.data) {
      expect(firstIds.has(row.id)).toBe(false);
    }
  });

  it("AC8: total counts rows above the floor, not the whole table", async () => {
    const { body } = await search("search=bike&mode=semantic&limit=2");

    // A real behavioural difference between modes, and one Swagger has to document.
    expect(body.total).toBeLessThan(catalogue.length);
    expect(body.total).toBeGreaterThanOrEqual(body.data.length);
  });

  it("AC3: excludes rows whose embedding is null from the vector arm", async () => {
    const seller = await makeUser({ role: "seller" });
    await makeListing({ sellerId: seller.id, title: "Unembedded bike", description: "No vector." });

    const { body } = await search("search=bike&mode=semantic&limit=50");
    expect(body.data.map((r) => r.title)).not.toContain("Unembedded bike");
  });
});

describe("C2C-AI-7 — AC5/AC6: hybrid mode", () => {
  it("AC5: a listing matching both arms outranks one matching only the vector arm", async () => {
    const { body } = await search("search=bicycle&mode=hybrid&limit=20");

    const titles = body.data.map((r) => r.title);
    const bothArms = titles.findIndex((t) => t.toLowerCase().includes("bicycle"));
    const vectorOnly = titles.findIndex((t) => !t.toLowerCase().includes("bicycle"));

    expect(bothArms).toBeGreaterThanOrEqual(0);
    expect(vectorOnly).toBeGreaterThanOrEqual(0);
    expect(bothArms).toBeLessThan(vectorOnly);
  });

  it("AC6: a listing whose embedding is null still appears when its title matches", async () => {
    const seller = await makeUser({ role: "seller" });
    await makeListing({
      sellerId: seller.id,
      title: "Vintage bicycle with no vector",
      description: "Its embedding failed to compute.",
    });

    const { body } = await search("search=bicycle&mode=hybrid&limit=50");

    // Otherwise a failed embedding (AI-4 AC2) would silently hide a listing for good.
    expect(body.data.map((r) => r.title)).toContain("Vintage bicycle with no vector");
  });

  it("AC6: a row reachable only through the keyword arm has no similarity", async () => {
    const seller = await makeUser({ role: "seller" });
    await makeListing({
      sellerId: seller.id,
      title: "Vintage bicycle with no vector",
      description: "Its embedding failed to compute.",
    });

    const { body } = await search("search=bicycle&mode=hybrid&limit=50");
    const row = body.data.find((r) => r.title === "Vintage bicycle with no vector");

    expect(row).toBeDefined();
    expect(row!.similarity).toBeUndefined();
  });

  it("AC5: hybrid finds rows that keyword alone cannot", async () => {
    const keyword = await search("search=pedal machine&mode=keyword");
    const hybrid = await search("search=pedal machine&mode=hybrid");

    expect(keyword.body.total).toBe(0);
    expect(hybrid.body.total).toBeGreaterThan(0);
  });

  it("AC8: hybrid pagination does not repeat a row across pages", async () => {
    const first = await search("search=bike&mode=hybrid&page=1&limit=3");
    const second = await search("search=bike&mode=hybrid&page=2&limit=3");

    const firstIds = new Set(first.body.data.map((r) => r.id));
    for (const row of second.body.data) {
      expect(firstIds.has(row.id)).toBe(false);
    }
  });
});

describe("C2C-AI-7 — AC7: filters apply in every mode", () => {
  it("AC7: categoryId and maxPrice both hold in every mode", async () => {
    const db = await getTestDb();
    const { listings } = await import("@/db/schema");
    const rows = await db.select().from(listings);
    const cyclingCategory = rows.find(
      (r) => r.id === catalogue.find((e) => e.cluster === "cycling")!.id,
    )!.categoryId!;

    for (const mode of ["keyword", "semantic", "hybrid"]) {
      const { body } = await search(
        `search=bike&mode=${mode}&categoryId=${cyclingCategory}&maxPrice=500&limit=50`,
      );

      for (const row of body.data) {
        const full = rows.find((r) => r.id === row.id)!;
        expect(full.categoryId).toBe(cyclingCategory);
        expect(Number(full.price)).toBeLessThanOrEqual(500);
      }
    }
  });

  it("AC7: minPrice holds in semantic mode", async () => {
    const { body } = await search("search=bike&mode=semantic&minPrice=300&limit=50");
    const db = await getTestDb();
    const { listings } = await import("@/db/schema");
    const rows = await db.select().from(listings);

    for (const row of body.data) {
      expect(Number(rows.find((r) => r.id === row.id)!.price)).toBeGreaterThanOrEqual(300);
    }
  });
});

describe("C2C-AI-7 — AC9: invalid input", () => {
  it("AC9: an unknown mode is a 400 naming the allowed values", async () => {
    const { status, body } = await search("search=bike&mode=fuzzy");

    expect(status).toBe(400);
    const message = JSON.stringify(body);
    expect(message).toContain("keyword");
    expect(message).toContain("semantic");
    expect(message).toContain("hybrid");
  });

  it("AC9: an invalid mode is rejected even with no search term", async () => {
    const { status } = await search("mode=fuzzy");
    expect(status).toBe(400);
  });
});

describe("C2C-AI-7 — AC12: the seller-privacy fix survives", () => {
  it("AC12: an anonymous caller with ?sellerId= sees only active listings, in every mode", async () => {
    const seller = await makeUser({ role: "seller" });
    const category = await makeCategory();
    await makeListing({
      sellerId: seller.id,
      categoryId: category.id,
      title: "Sold bike",
      status: "sold",
      embedding: queryEmbedding("bike"),
    });
    await makeListing({
      sellerId: seller.id,
      categoryId: category.id,
      title: "Removed bike",
      status: "removed",
      embedding: queryEmbedding("bike"),
    });
    await makeListing({
      sellerId: seller.id,
      categoryId: category.id,
      title: "Active bike",
      status: "active",
      embedding: queryEmbedding("bike"),
    });

    for (const mode of ["keyword", "semantic", "hybrid"]) {
      const { body } = await search(`sellerId=${seller.id}&search=bike&mode=${mode}&limit=50`);

      for (const row of body.data) {
        expect(row.status).toBe("active");
      }
      expect(body.data.map((r) => r.title)).not.toContain("Sold bike");
      expect(body.data.map((r) => r.title)).not.toContain("Removed bike");
    }
  });

  it("AC12: a seller viewing their own inventory still sees every status, in every mode", async () => {
    const seller = await makeUser({ role: "seller" });
    await makeListing({
      sellerId: seller.id,
      title: "My sold bike",
      status: "sold",
      embedding: queryEmbedding("bike"),
    });

    for (const mode of ["keyword", "semantic", "hybrid"]) {
      const { body } = await search(
        `sellerId=${seller.id}&search=bike&mode=${mode}&limit=50`,
        authHeaderFor(seller),
      );
      expect(body.data.map((r) => r.title)).toContain("My sold bike");
    }
  });
});
