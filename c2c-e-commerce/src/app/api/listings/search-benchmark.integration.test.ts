/**
 * C2C-AI-7 spec — AC11, the latency benchmark.
 *
 * A benchmark, not a CI gate: the story says to record the number for the thesis
 * evaluation chapter rather than fail a build on it. Seeding 1 000 listings takes long
 * enough that it is opt-in:
 *
 *   RUN_BENCHMARKS=1 npm run test:integration -- src/app/api/listings/search-benchmark.integration.test.ts
 */
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getTestDb, resetDb } from "@/test/db";
import { makeCategory, makeUser } from "@/test/factories";
import {
  clusterEmbedding,
  queryEmbedding,
  SEMANTIC_CLUSTERS,
} from "@/test/fixtures/semantic-catalogue";

const enabled = process.env.RUN_BENCHMARKS === "1";
const LISTING_COUNT = 1_000;

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

async function timeSearch(query: string): Promise<number> {
  const { GET } = await import("./route");
  const started = performance.now();
  await GET(new NextRequest(`http://localhost/api/listings?${query}`));
  return performance.now() - started;
}

describe.skipIf(!enabled)("C2C-AI-7 — AC11: hybrid latency at 1 000 listings", () => {
  beforeAll(async () => {
    await resetDb();

    const db = await getTestDb();
    const { listings } = await import("@/db/schema");
    const seller = await makeUser({ role: "seller" });
    const category = await makeCategory();

    const rows = Array.from({ length: LISTING_COUNT }, (_, i) => {
      const cluster = SEMANTIC_CLUSTERS[i % SEMANTIC_CLUSTERS.length];
      const title = `${cluster} listing ${i}`;
      return {
        title,
        description: `A seeded ${cluster} listing, number ${i}.`,
        price: String(10 + (i % 900)),
        sellerId: seller.id,
        categoryId: category.id,
        status: "active" as const,
        embedding: clusterEmbedding(cluster, title),
        embeddingUpdatedAt: new Date(),
      };
    });

    for (let i = 0; i < rows.length; i += 100) {
      await db.insert(listings).values(rows.slice(i, i + 100));
    }
  }, 600_000);

  it("AC11: records p95 over 20 runs", async () => {
    await timeSearch("search=bike&mode=hybrid"); // warm the plan cache

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push(await timeSearch("search=bike&mode=hybrid"));
    }
    samples.sort((a, b) => a - b);

    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.floor(samples.length * 0.95)];

    console.log(
      `AC11 hybrid over ${LISTING_COUNT} listings: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
    );

    // Recorded, not gated — the story is explicit that this is thesis input.
    expect(samples).toHaveLength(20);
    expect(p95).toBeGreaterThan(0);
  }, 300_000);
});
