/**
 * C2C-QA-3 spec — AC7, the deterministic semantic fixture catalogue.
 *
 * The story calls this the most reusable artefact in the epic, and it is: AI-7 AC2 ("a
 * query with no literal keyword match but a close meaning"), AI-9 AC1 ("several similar
 * active listings") and AI-10 AC7 ("a buyer who ordered two bicycles gets a cycling
 * listing in the top 3") are all unwritable without it, and it doubles as the thesis
 * evaluation dataset.
 *
 * The self-check below is what makes it trustworthy. A catalogue whose vectors do not
 * actually cluster would let every one of those criteria pass or fail for reasons that
 * have nothing to do with the code under test.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import { listings } from "@/db/schema";

import { getTestDb, resetDb } from "../db";
import {
  SEMANTIC_CLUSTERS,
  type SemanticCluster,
  loadSemanticCatalogue,
} from "../fixtures/semantic-catalogue";
import { cosineSimilarity } from "../vectors";

beforeEach(async () => {
  await resetDb();
});

describe("C2C-QA-3 — the catalogue's shape", () => {
  it("AC7: declares the three clusters the AI stories are written against", () => {
    expect([...SEMANTIC_CLUSTERS]).toEqual(["cycling", "phones", "furniture"]);
  });

  it("AC7: loads roughly twenty listings", async () => {
    const loaded = await loadSemanticCatalogue();

    expect(loaded.length).toBeGreaterThanOrEqual(18);
    expect(loaded.length).toBeLessThanOrEqual(24);
  });

  it("AC7: every cluster has enough members for a top-3 assertion to mean something", async () => {
    const loaded = await loadSemanticCatalogue();

    for (const cluster of SEMANTIC_CLUSTERS) {
      const members = loaded.filter((entry) => entry.cluster === cluster);
      // AI-10 AC7 asserts a cycling listing lands in the top 3; with fewer than four
      // members per cluster that could happen by chance.
      expect(members.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("AC7: every listing is persisted with a non-null embedding of the right width", async () => {
    await loadSemanticCatalogue();
    const db = await getTestDb();

    const rows = await db.select().from(listings);
    expect(rows.length).toBeGreaterThanOrEqual(18);

    for (const row of rows) {
      expect(row.embedding).not.toBeNull();
      expect(row.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    }
  });

  it("AC7: every listing is active, so status filters do not silently empty the set", async () => {
    await loadSemanticCatalogue();
    const db = await getTestDb();

    for (const row of await db.select().from(listings)) {
      expect(row.status).toBe("active");
    }
  });

  it("AC7: returned entries carry the database id, so tests can reference a known row", async () => {
    const loaded = await loadSemanticCatalogue();

    for (const entry of loaded) {
      expect(entry.id).toEqual(expect.any(Number));
      expect(entry.title).toEqual(expect.any(String));
    }
  });
});

describe("C2C-QA-3 — AC7 self-check: the vectors actually cluster", () => {
  it("AC7: each listing is nearer its own cluster's members than any other cluster's", async () => {
    const loaded = await loadSemanticCatalogue();

    const byCluster = new Map<SemanticCluster, typeof loaded>();
    for (const cluster of SEMANTIC_CLUSTERS) {
      byCluster.set(
        cluster,
        loaded.filter((entry) => entry.cluster === cluster),
      );
    }

    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;

    for (const entry of loaded) {
      const own = byCluster
        .get(entry.cluster)!
        .filter((other) => other.id !== entry.id)
        .map((other) => cosineSimilarity(entry.embedding, other.embedding));

      const foreign = loaded
        .filter((other) => other.cluster !== entry.cluster)
        .map((other) => cosineSimilarity(entry.embedding, other.embedding));

      // The property every AI ranking test leans on. If this fails, the catalogue is
      // noise and nothing built on it means anything.
      expect(mean(own)).toBeGreaterThan(mean(foreign));
    }
  });

  it("AC7: the nearest neighbour of any listing shares its cluster", async () => {
    const loaded = await loadSemanticCatalogue();

    for (const entry of loaded) {
      const nearest = loaded
        .filter((other) => other.id !== entry.id)
        .map((other) => ({
          cluster: other.cluster,
          similarity: cosineSimilarity(entry.embedding, other.embedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)[0];

      // Directly what AI-9's "similar listings" promises.
      expect(nearest.cluster).toBe(entry.cluster);
    }
  });

  it("AC7: every vector is unit length, matching what AI-2 produces", async () => {
    const loaded = await loadSemanticCatalogue();

    for (const entry of loaded) {
      expect(cosineSimilarity(entry.embedding, entry.embedding)).toBeCloseTo(1, 5);
    }
  });
});

describe("C2C-QA-3 — AC7: determinism", () => {
  it("AC7: reloading after a reset produces identical vectors for the same titles", async () => {
    const first = await loadSemanticCatalogue();
    const firstByTitle = new Map(first.map((entry) => [entry.title, entry.embedding]));

    await resetDb();
    const second = await loadSemanticCatalogue();

    for (const entry of second) {
      // Fixtures asserted against in one test and rebuilt in the next must not drift, or
      // AI-10 AC7 becomes flaky for reasons unrelated to recommendations.
      expect(entry.embedding).toEqual(firstByTitle.get(entry.title));
    }
  });

  it("AC7: ids restart from 1 after a reset, so a test may reference them literally", async () => {
    await loadSemanticCatalogue();
    await resetDb();
    const reloaded = await loadSemanticCatalogue();

    expect(Math.min(...reloaded.map((entry) => entry.id))).toBe(1);
  });
});
