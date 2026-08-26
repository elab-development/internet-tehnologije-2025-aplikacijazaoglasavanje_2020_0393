/**
 * C2C-AI-7 — building the listings query.
 *
 * SPEC PHASE SKELETON.
 */
const NOT_IMPLEMENTED = "not implemented — C2C-AI-7 is in its spec phase";

/** Additive by decision D8: `keyword` is the default, so existing clients are unaffected. */
export const SEARCH_MODES = ["keyword", "semantic", "hybrid"] as const;

export type SearchMode = (typeof SEARCH_MODES)[number];

/** Reciprocal-rank-fusion constant, fixed at 60 by the story. */
export const RRF_K = 60;

/** Cosine similarity below which a semantic match is not worth returning. */
export const MIN_SIMILARITY = 0.25;

export type ParsedSearchMode =
  | { ok: true; mode: SearchMode }
  | { ok: false; error: string };

/** Resolves the `mode` query parameter. */
export function parseSearchMode(_raw: string | null): ParsedSearchMode {
  throw new Error(NOT_IMPLEMENTED);
}

/** Fuses several rankings of ids into one, by reciprocal rank fusion. */
export function reciprocalRankFusion(
  _rankings: number[][],
  _k?: number,
): { id: number; score: number }[] {
  throw new Error(NOT_IMPLEMENTED);
}
