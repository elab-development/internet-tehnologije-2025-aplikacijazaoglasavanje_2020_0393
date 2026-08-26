/**
 * C2C-AI-4 — `npm run db:backfill-embeddings`.
 *
 * SPEC PHASE SKELETON.
 */
const NOT_IMPLEMENTED = "not implemented — C2C-AI-4 is in its spec phase";

export type BackfillSummary = {
  /** Rows that got a fresh vector. */
  processed: number;
  /** Rows with no embeddable text — not an error (AC7). */
  skipped: number;
  /** Rows whose embedding threw; the run continues. */
  failed: number;
};

export type BackfillOptions = { batchSize?: number };

/** Embeds every row whose vector is missing or older than its text. Safely re-runnable. */
export function backfillEmbeddings(
  _options?: BackfillOptions,
): Promise<BackfillSummary> {
  throw new Error(NOT_IMPLEMENTED);
}
