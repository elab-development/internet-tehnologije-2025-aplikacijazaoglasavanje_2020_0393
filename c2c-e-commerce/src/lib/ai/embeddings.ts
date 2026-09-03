/**
 * C2C-AI-2 — local embedding provider.
 *
 * Turns arbitrary text into 384-dimension unit vectors in-process, with no API key and no
 * network once the model is cached. Everything vector-related — AI-3's column, AI-4's
 * write path, AI-7's semantic search, AI-9 and AI-10 — depends on this seam, and on being
 * able to swap it for something deterministic in tests.
 *
 * Environment:
 *   EMBEDDING_PROVIDER  "local" | "mock" — defaults to mock under NODE_ENV=test
 *   TRANSFORMERS_CACHE  where model files live; set in Docker so the bake survives
 */
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Output width of Xenova/all-MiniLM-L6-v2, fixed by decision D2.
 *
 * The single source of truth: AI-3's `vector(384)` column, AI-4's write path and the mock
 * provider all derive from this rather than repeating the literal.
 */
export const EMBEDDING_DIMENSIONS = 384;

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const MOCK_MODEL = "mock-embedding-v1";

export interface EmbeddingProvider {
  /** Model identifier, for logs and for telling mock output from real output. */
  readonly model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Pays the model load up front, at server start, instead of on the first request. */
  warmup(): Promise<void>;
}

// ─── Local ────────────────────────────────────────────────────────────────────

/**
 * The shared pipeline, memoised as a *promise* rather than as the resolved value.
 *
 * Caching the resolved pipeline leaves a window in which two concurrent first requests
 * both see `undefined` and both start a ~4.5 s model load. Caching the promise means the
 * second caller awaits the first one's work — and route handlers under Next.js are exactly
 * the concurrent-first-request case.
 */
let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");

      // The default cache lives inside node_modules, which the multi-stage Docker build
      // discards along with the builder's dependencies. An explicit path is what makes
      // the AC7 bake copyable between stages.
      if (process.env.TRANSFORMERS_CACHE) {
        env.cacheDir = process.env.TRANSFORMERS_CACHE;
      }

      return pipeline("feature-extraction", EMBEDDING_MODEL);
    })();

    // Do not memoise a rejection: a transient failure to load would otherwise poison the
    // process for its whole lifetime.
    pipelinePromise.catch(() => {
      pipelinePromise = undefined;
    });
  }

  return pipelinePromise;
}

/** Transformers.js running all-MiniLM-L6-v2 in-process, on CPU. */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model = EMBEDDING_MODEL;

  async warmup(): Promise<void> {
    await getPipeline();
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const extract = await getPipeline();
    // `normalize: true` yields unit vectors, which makes cosine distance and inner product
    // equivalent and keeps AI-3's pgvector index choice simple.
    const tensor = await extract(texts, { pooling: "mean", normalize: true });

    // A batch call returns ONE tensor of dims [N, 384] over a flat Float32Array of
    // N * 384 values — not N vectors. Slicing per row is mandatory; skipping it yields a
    // single 1 152-long "vector" that only fails later, when pgvector rejects the insert.
    const data = tensor.data as Float32Array;
    return texts.map((_text, i) =>
      Array.from(
        data.subarray(i * EMBEDDING_DIMENSIONS, (i + 1) * EMBEDDING_DIMENSIONS),
      ),
    );
  }
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

/** FNV-1a, 32-bit — the same hash AI-1's MockProvider uses. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic, offline pseudo-vectors of the same width.
 *
 * Stable across *instances*, not merely across calls on one instance: QA-3's fixture
 * catalogue is built once and asserted against later, so an instance-varying mock would
 * make those fixtures meaningless.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = MOCK_MODEL;

  warmup(): Promise<void> {
    return Promise.resolve();
  }

  embed(text: string): Promise<number[]> {
    // mulberry32, seeded by the hash: a small PRNG that fills all 384 slots from one
    // 32-bit seed and gives visibly different vectors for near-identical inputs.
    let state = fnv1a(text);
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
    });

    // Normalise explicitly — AC2 holds for the mock as well as for the real model.
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return Promise.resolve(vector.map((value) => value / norm));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

type ProviderKind = "local" | "mock";

/**
 * One instance per kind, kept for the life of the process.
 *
 * The opposite of `getLlmProvider()`, which deliberately memoises nothing: there a fresh
 * instance costs two env reads, here it would cost a ~25 MB model load. Keying the cache
 * by kind rather than using a single slot lets a test switch providers and still get a
 * stable instance for each.
 */
const instances = new Map<ProviderKind, EmbeddingProvider>();

export function getEmbeddingProvider(): EmbeddingProvider {
  const configured = process.env.EMBEDDING_PROVIDER?.trim();
  const choice = configured || (process.env.NODE_ENV === "test" ? "mock" : "local");

  if (choice !== "local" && choice !== "mock") {
    throw new Error(
      `EMBEDDING_PROVIDER must be "local" or "mock", received "${configured}"`,
    );
  }

  let instance = instances.get(choice);
  if (!instance) {
    instance = choice === "mock" ? new MockEmbeddingProvider() : new LocalEmbeddingProvider();
    instances.set(choice, instance);
  }
  return instance;
}

/** Called at server start so the first real request does not pay the model load. */
export function warmupEmbeddings(): Promise<void> {
  return getEmbeddingProvider().warmup();
}
