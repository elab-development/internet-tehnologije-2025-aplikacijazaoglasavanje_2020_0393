/**
 * Vector helpers for tests.
 *
 * Introduced by C2C-AI-2 and reused by QA-3's fixture self-check and the AI-7 ranking
 * tests, so that "similar" means the same arithmetic everywhere.
 */

/** Euclidean length. Unit vectors — what `normalize: true` produces — measure 1. */
export function l2Norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

/**
 * Cosine similarity in [-1, 1].
 *
 * For unit vectors this is just the dot product, but the full form is used here so the
 * helper stays correct if it is ever handed something unnormalised.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cannot compare vectors of length ${a.length} and ${b.length}`);
  }
  const dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
  const magnitude = l2Norm(a) * l2Norm(b);
  return magnitude === 0 ? 0 : dot / magnitude;
}
