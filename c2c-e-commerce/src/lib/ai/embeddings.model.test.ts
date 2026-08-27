/**
 * C2C-AI-2 spec — the acceptance criteria that require the real model.
 *
 * These load Xenova/all-MiniLM-L6-v2 and run it on CPU. The story's test notes are
 * explicit that this belongs in the unit suite despite being slow: AC3 is the only
 * evidence that the vectors carry meaning at all, and a mocked version of it would prove
 * nothing about the embeddings.
 *
 * The model is downloaded once (~25 MB) and cached on disk thereafter.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { cosineSimilarity, l2Norm } from "../../test/vectors";
import { EMBEDDING_DIMENSIONS, LocalEmbeddingProvider } from "./embeddings";

const provider = new LocalEmbeddingProvider();

beforeAll(async () => {
  // Pay the model load once, here, so no individual test's duration is really a
  // measurement of the cold start.
  await provider.warmup();
}, 180_000);

describe("C2C-AI-2 — LocalEmbeddingProvider", () => {
  it("AC1: embed() returns exactly 384 finite numbers", async () => {
    const vector = await provider.embed("iPhone 15 Pro");

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vector).toHaveLength(384);
    expect(vector.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("AC2: the returned vector is L2-normalised to 1.0 ± 0.001", async () => {
    const vector = await provider.embed("iPhone 15 Pro");
    expect(l2Norm(vector)).toBeCloseTo(1, 3);
  });

  it("AC3: semantically close texts are closer to each other than to an unrelated one", async () => {
    // The criterion the whole epic rests on. If this fails, semantic search is noise.
    const [bike, bicycle, chair] = await provider.embedBatch([
      "used mountain bike",
      "second-hand bicycle for trails",
      "leather office chair",
    ]);

    const closePair = cosineSimilarity(bike, bicycle);
    const bikeToChair = cosineSimilarity(bike, chair);
    const bicycleToChair = cosineSimilarity(bicycle, chair);

    expect(closePair).toBeGreaterThan(bikeToChair);
    expect(closePair).toBeGreaterThan(bicycleToChair);
  });

  it("AC4: two calls with identical input in one process return identical vectors", async () => {
    const first = await provider.embed("used mountain bike");
    const second = await provider.embed("used mountain bike");
    expect(first).toEqual(second);
  });

  it("AC5: embedBatch returns N vectors in input order", async () => {
    const texts = [
      "red racing bicycle",
      "walnut dining table",
      "wireless noise-cancelling headphones",
    ];

    const batch = await provider.embedBatch(texts);
    expect(batch).toHaveLength(texts.length);

    // Order is asserted by content, not by position alone: each batched vector must match
    // the one embed() produces for the text at that index.
    for (const [i, text] of texts.entries()) {
      expect(cosineSimilarity(batch[i], await provider.embed(text))).toBeCloseTo(1, 5);
    }
  });

  it("AC5: embedBatch is faster than the same texts embedded one at a time", async () => {
    const texts = Array.from({ length: 8 }, (_, i) => `marketplace listing number ${i}`);

    const time = async (run: () => Promise<unknown>) => {
      const started = performance.now();
      await run();
      return performance.now() - started;
    };

    // Best of three on each side, rather than one sample each. A single pair is decided by
    // whichever run caught a GC pause: this test passed alone and failed inside the full
    // suite, where the other projects are competing for the same CPU. Taking the minimum
    // measures the property AC5 is about — batching does less work — instead of measuring
    // the scheduler.
    const sequential: number[] = [];
    const batched: number[] = [];

    for (let i = 0; i < 3; i++) {
      sequential.push(
        await time(async () => {
          for (const text of texts) await provider.embed(text);
        }),
      );
      batched.push(await time(() => provider.embedBatch(texts)));
    }

    expect(Math.min(...batched)).toBeLessThan(Math.min(...sequential));
  }, 60_000);

  it("AC5: embedBatch on an empty list resolves to an empty list without calling the model", async () => {
    await expect(provider.embedBatch([])).resolves.toEqual([]);
  });

  it("the model is loaded once per process, not once per call", async () => {
    // warmup() already paid the load in beforeAll, so a subsequent embed cannot be
    // anywhere near the 1-3 s cold start. This is the observable form of "module-level
    // singleton" — a second load would show up here as seconds, not milliseconds.
    const started = performance.now();
    await provider.embed("a short phrase");
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("reports the model it actually loaded", () => {
    expect(provider.model).toContain("all-MiniLM-L6-v2");
  });

  it("embeds text far longer than the model's context window without throwing", async () => {
    // buildEmbeddingText() in AI-4 concatenates a title and a full description; MiniLM
    // truncates at 256 tokens and must not reject the input.
    const long = "second-hand road bicycle in good condition. ".repeat(200);

    const vector = await provider.embed(long);
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(l2Norm(vector)).toBeCloseTo(1, 3);
  });
});
