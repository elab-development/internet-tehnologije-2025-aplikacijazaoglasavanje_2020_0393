/**
 * C2C-AI-4 — `npm run db:backfill-embeddings`.
 *
 * Every listing that exists, old or new, needs a vector or it is invisible to semantic
 * search. This is the safety net under AC2: a write whose embedding failed leaves a NULL,
 * and this fills it in later.
 *
 * Exported as a function rather than written as a bare script so the spec can call it
 * directly. A file that only worked as a subprocess would have to have its output parsed
 * to be tested at all.
 */
import { and, asc, gt, isNull, lt, or, sql } from "drizzle-orm";

import { getEmbeddingProvider } from "@/lib/ai/embeddings";
import { buildEmbeddingText } from "@/lib/ai/listing-embedding";

import { db } from "./index";
import { listings } from "./schema";

export type BackfillSummary = {
  /** Rows that got a fresh vector. */
  processed: number;
  /** Rows with no embeddable text — not an error (AC7). */
  skipped: number;
  /** Rows whose embedding threw; the run continues. */
  failed: number;
};

export type BackfillOptions = {
  batchSize?: number;
  /** Set false in tests that assert on the summary rather than the output. */
  verbose?: boolean;
};

/**
 * AI-2 measured `embedBatch(8)` at 2.4x a sequential loop; the win flattens out beyond
 * that, and a larger batch only grows the memory held per iteration.
 */
const DEFAULT_BATCH_SIZE = 32;

/**
 * A row needs embedding when it has no vector, or when its text has moved on since the
 * vector was written.
 *
 * `embedding_updated_at IS NULL` is listed separately from `embedding IS NULL` because
 * PATCH clears both on a failed re-embed, and a row could in principle carry one without
 * the other.
 */
const isStale = or(
  isNull(listings.embedding),
  isNull(listings.embeddingUpdatedAt),
  lt(listings.embeddingUpdatedAt, listings.updatedAt),
);

/** Embeds every row whose vector is missing or older than its text. Safely re-runnable. */
export async function backfillEmbeddings(
  options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const verbose = options.verbose ?? false;
  const provider = getEmbeddingProvider();

  const summary: BackfillSummary = { processed: 0, skipped: 0, failed: 0 };

  // Keyed on id rather than OFFSET: this writes to the same rows it selects, so an OFFSET
  // walk would skip rows as the result set shifted underneath it. Staleness is re-read
  // every batch, so rows that go stale mid-run are picked up too.
  let cursor = 0;

  for (;;) {
    const batch = await db
      .select({
        id: listings.id,
        title: listings.title,
        description: listings.description,
      })
      .from(listings)
      .where(and(isStale, gt(listings.id, cursor)))
      .orderBy(asc(listings.id))
      .limit(batchSize);

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    const embeddable = batch
      .map((row) => ({ row, text: buildEmbeddingText(row) }))
      .filter((entry) => {
        if (entry.text) return true;
        // Nothing to embed is not an error, and AC7 forbids sending "" to the model.
        summary.skipped += 1;
        return false;
      });

    if (embeddable.length === 0) continue;

    let vectors: number[][];
    try {
      vectors = await provider.embedBatch(embeddable.map((entry) => entry.text));
    } catch (error) {
      // One bad batch must not end the run; retry the rows singly so a single poisonous
      // listing is isolated rather than taking its neighbours down with it.
      for (const entry of embeddable) {
        try {
          const [vector] = await provider.embedBatch([entry.text]);
          await writeVector(entry.row.id, vector);
          summary.processed += 1;
        } catch (rowError) {
          summary.failed += 1;
          console.error(`  failed listing ${entry.row.id}:`, rowError);
        }
      }
      if (verbose) console.error("  batch failed, retried row by row:", error);
      continue;
    }

    for (const [i, entry] of embeddable.entries()) {
      await writeVector(entry.row.id, vectors[i]);
      summary.processed += 1;
    }

    if (verbose) {
      console.log(
        `  processed ${summary.processed}, skipped ${summary.skipped}, failed ${summary.failed}`,
      );
    }
  }

  return summary;
}

/**
 * Writes a vector without touching `updated_at`.
 *
 * Raw SQL on purpose. The Drizzle column carries `$onUpdate`, so `db.update()` would stamp
 * `updated_at` here — and `updated_at` means "the listing's text changed", which a backfill
 * never does. Letting it advance would leave the row stale the instant it was fixed
 * (`embedding_updated_at < updated_at` again on the next clock tick), so every run would
 * re-embed everything forever.
 *
 * Both timestamps also have to come from the same clock: `now()` is Postgres's, `new Date()`
 * is Node's, and the few milliseconds between them are enough to invert the comparison.
 */
async function writeVector(id: number, embedding: number[]): Promise<void> {
  await db.execute(sql`
    UPDATE listings
       SET embedding = ${JSON.stringify(embedding)}::vector,
           embedding_updated_at = GREATEST(now(), updated_at)
     WHERE id = ${id}
  `);
}

/** CLI entry point. Only runs when this file is executed directly. */
if (require.main === module) {
  void (async () => {
    const started = Date.now();
    console.log("Backfilling listing embeddings...");

    try {
      const summary = await backfillEmbeddings({ verbose: true });
      console.log(
        `Done in ${Date.now() - started}ms — processed ${summary.processed}, ` +
          `skipped ${summary.skipped}, failed ${summary.failed}.`,
      );
      process.exit(summary.failed > 0 ? 1 : 0);
    } catch (error) {
      console.error("Backfill failed:", error);
      process.exit(1);
    }
  })();
}
