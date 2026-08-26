/**
 * C2C-AI-4 — keeping `listings.embedding` in sync with listing text.
 *
 * SPEC PHASE SKELETON.
 */
const NOT_IMPLEMENTED = "not implemented — C2C-AI-4 is in its spec phase";

/** The parts of a listing that determine its vector. */
export type EmbeddableListing = { title: string; description: string };

/**
 * The text a listing's vector represents.
 *
 * One definition, used by the write path *and* the backfill, so the two can never
 * disagree. Returns "" when there is nothing to embed — the caller must not send that to
 * a model (AC7).
 */
export function buildEmbeddingText(_listing: EmbeddableListing): string {
  throw new Error(NOT_IMPLEMENTED);
}

/** Whether an update changes the embedded text, and so requires a new vector. */
export function needsReembedding(
  _current: EmbeddableListing,
  _update: Partial<EmbeddableListing> & Record<string, unknown>,
): boolean {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Computes a listing's vector, or returns null when there is nothing to embed.
 *
 * Never throws: AI-4's technical note is explicit that an embedding failure must not fail
 * the write. The caller logs it with the listing id and lets the backfill catch up.
 */
export function computeListingEmbedding(
  _listing: EmbeddableListing,
): Promise<number[] | null> {
  throw new Error(NOT_IMPLEMENTED);
}
