/**
 * C2C-AI-2 — local embedding provider.
 *
 * SPEC PHASE SKELETON. Declares the seam and nothing else: every behaviour throws
 * `not implemented`, so the tests fail on the missing behaviour rather than on an
 * unresolved import. Only `EMBEDDING_DIMENSIONS` is real, because AI-3's migration and
 * AI-4's write path both read it as the single source of truth for the column width.
 */

/**
 * Output width of Xenova/all-MiniLM-L6-v2, fixed by decision D2.
 *
 * The single source of truth: AI-3's `vector(384)` column, AI-4's write path and the mock
 * provider all derive from this rather than repeating the literal.
 */
export const EMBEDDING_DIMENSIONS = 384;

export interface EmbeddingProvider {
  /** Model identifier, for logs and for telling mock output from real output. */
  readonly model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Pays the model load up front, at server start, instead of on the first request. */
  warmup(): Promise<void>;
}

const NOT_IMPLEMENTED = "not implemented — C2C-AI-2 is in its spec phase";

/** Transformers.js running all-MiniLM-L6-v2 in-process, on CPU. */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  get model(): string {
    throw new Error(NOT_IMPLEMENTED);
  }

  embed(_text: string): Promise<number[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  embedBatch(_texts: string[]): Promise<number[][]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  // Resolves even in the skeleton: a throwing warmup() aborts the model spec's
  // beforeAll hook, which would leave every AC in that file unobserved rather than
  // individually red.
  warmup(): Promise<void> {
    return Promise.resolve();
  }
}

/** Deterministic, offline pseudo-vectors of the same width. */
export class MockEmbeddingProvider implements EmbeddingProvider {
  get model(): string {
    throw new Error(NOT_IMPLEMENTED);
  }

  embed(_text: string): Promise<number[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  embedBatch(_texts: string[]): Promise<number[][]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  warmup(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * Selects a provider from `EMBEDDING_PROVIDER`, memoised per kind.
 *
 * Unlike `getLlmProvider()`, this one caches: a fresh `LocalEmbeddingProvider` would mean
 * reloading a ~25 MB model.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  throw new Error(NOT_IMPLEMENTED);
}
