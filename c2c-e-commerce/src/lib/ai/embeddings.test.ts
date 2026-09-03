/**
 * C2C-AI-2 spec — the parts that must never load a model.
 *
 * Fast tests only: the mock provider, the factory, and the dimension constant. The
 * acceptance criteria that require the real Transformers.js model live in
 * `embeddings.model.test.ts`, and AC7 (the Docker cache) in `embeddings.docker.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { cosineSimilarity, l2Norm } from "../../test/vectors";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingProvider,
  LocalEmbeddingProvider,
  MockEmbeddingProvider,
  getEmbeddingProvider,
} from "./embeddings";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("C2C-AI-2 — dimension constant", () => {
  it("AC1: EMBEDDING_DIMENSIONS is 384, the width all-MiniLM-L6-v2 produces", () => {
    // Decision D2 fixes the pgvector column at vector(384); AI-3's migration reads this
    // constant rather than repeating the number.
    expect(EMBEDDING_DIMENSIONS).toBe(384);
  });
});

describe("C2C-AI-2 — getEmbeddingProvider factory", () => {
  it("AC6: EMBEDDING_PROVIDER=mock yields the mock provider", () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "mock");
    expect(getEmbeddingProvider()).toBeInstanceOf(MockEmbeddingProvider);
  });

  it("AC6: an unset EMBEDDING_PROVIDER defaults to mock under NODE_ENV=test", () => {
    vi.stubEnv("EMBEDDING_PROVIDER", undefined);
    vi.stubEnv("NODE_ENV", "test");
    expect(getEmbeddingProvider()).toBeInstanceOf(MockEmbeddingProvider);
  });

  it("AC6: an unset EMBEDDING_PROVIDER defaults to the local model outside NODE_ENV=test", () => {
    vi.stubEnv("EMBEDDING_PROVIDER", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(getEmbeddingProvider()).toBeInstanceOf(LocalEmbeddingProvider);
  });

  it("AC6: an unrecognised EMBEDDING_PROVIDER throws, naming the allowed values", () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    expect(() => getEmbeddingProvider()).toThrowError(
      /local[\s\S]*mock|mock[\s\S]*local/,
    );
  });

  it("returns one shared instance per provider kind, so the model loads once per process", () => {
    // The counterpart of AI-1's deliberately un-memoised getLlmProvider(): there a fresh
    // instance costs two env reads, here it would cost a ~25 MB model load.
    vi.stubEnv("EMBEDDING_PROVIDER", "local");
    expect(getEmbeddingProvider()).toBe(getEmbeddingProvider());

    vi.stubEnv("EMBEDDING_PROVIDER", "mock");
    expect(getEmbeddingProvider()).toBe(getEmbeddingProvider());
  });

  it("hands back a different instance when the configured kind changes", () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "mock");
    const mock = getEmbeddingProvider();

    vi.stubEnv("EMBEDDING_PROVIDER", "local");
    expect(getEmbeddingProvider()).not.toBe(mock);
  });
});

describe("C2C-AI-2 — MockEmbeddingProvider", () => {
  const provider: EmbeddingProvider = new MockEmbeddingProvider();

  it("AC6/AC1: returns exactly EMBEDDING_DIMENSIONS finite numbers", async () => {
    const vector = await provider.embed("iPhone 15 Pro");

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vector.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("AC6/AC2: returns a unit vector", async () => {
    const vector = await provider.embed("iPhone 15 Pro");
    expect(l2Norm(vector)).toBeCloseTo(1, 3);
  });

  it("AC6/AC4: returns an identical vector for identical input", async () => {
    const first = await provider.embed("used mountain bike");
    const second = await provider.embed("used mountain bike");
    expect(first).toEqual(second);
  });

  it("AC6: is deterministic across separate instances, not just repeated calls", async () => {
    // QA-3's fixture catalogue is built once and asserted against later; a mock that
    // varied per instance would make those fixtures worthless.
    const a = await new MockEmbeddingProvider().embed("leather office chair");
    const b = await new MockEmbeddingProvider().embed("leather office chair");
    expect(a).toEqual(b);
  });

  it("AC6: gives different inputs different vectors, so ranking tests can assert an order", async () => {
    const bike = await provider.embed("used mountain bike");
    const chair = await provider.embed("leather office chair");

    expect(bike).not.toEqual(chair);
    expect(cosineSimilarity(bike, chair)).toBeLessThan(0.99);
  });

  it("AC6: loads no model — no network, and fast enough that nothing could have", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const started = performance.now();
    await new MockEmbeddingProvider().embed("iPhone 15 Pro");
    const elapsed = performance.now() - started;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(100);
  });

  it("AC5: embedBatch returns one vector per input, in input order", async () => {
    const texts = ["first", "second", "third"];
    const batch = await provider.embedBatch(texts);

    expect(batch).toHaveLength(texts.length);
    for (const [i, text] of texts.entries()) {
      expect(batch[i]).toEqual(await provider.embed(text));
    }
  });

  it("AC5: embedBatch on an empty list resolves to an empty list", async () => {
    await expect(provider.embedBatch([])).resolves.toEqual([]);
  });

  it("warmup() resolves without loading anything", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(new MockEmbeddingProvider().warmup()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a model identifier distinguishable from the real one", async () => {
    expect(provider.model).toEqual(expect.any(String));
    expect(provider.model).not.toContain("MiniLM");
  });
});
