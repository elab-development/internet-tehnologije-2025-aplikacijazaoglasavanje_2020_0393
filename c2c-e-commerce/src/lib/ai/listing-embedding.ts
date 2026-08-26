/**
 * C2C-AI-4 — keeping `listings.embedding` in sync with listing text.
 *
 * Every listing that exists, old or new, needs a vector or it is invisible to semantic
 * search. This module owns the one definition of *what* gets embedded, so the write path
 * and the backfill can never disagree — if they did, a backfilled row and a freshly
 * written one would sit in different places in the same vector space, and nothing
 * downstream would reveal it.
 */
import { getEmbeddingProvider } from "./embeddings";

/** The parts of a listing that determine its vector. */
export type EmbeddableListing = { title: string; description: string };

/**
 * The text a listing's vector represents.
 *
 * Returns `""` when there is nothing to embed. The caller must not send that to a model:
 * AC7 forbids an empty-string embed call, and the vector would be meaningless anyway.
 */
export function buildEmbeddingText(listing: EmbeddableListing): string {
  const title = listing.title?.trim() ?? "";
  const description = listing.description?.trim() ?? "";

  // A blank half is dropped rather than left as leading or trailing whitespace, so a
  // listing with only a description embeds the same text it would if the title were absent.
  return [title, description].filter(Boolean).join("\n\n");
}

/**
 * Whether an update changes the embedded text, and so requires a new vector.
 *
 * Compares the *built text*, not which fields are present. A client that PUTs the whole
 * object on every save would otherwise re-embed on every price change, and a title
 * differing only in whitespace would produce an identical vector at full cost.
 */
export function needsReembedding(
  current: EmbeddableListing,
  update: Partial<EmbeddableListing> & Record<string, unknown>,
): boolean {
  const next: EmbeddableListing = {
    title: typeof update.title === "string" ? update.title : current.title,
    description:
      typeof update.description === "string" ? update.description : current.description,
  };

  return buildEmbeddingText(next) !== buildEmbeddingText(current);
}

/**
 * What came of trying to embed a listing.
 *
 * Three outcomes rather than `number[] | null`, because the callers need to tell them
 * apart: AC2 logs only a genuine failure, and the backfill counts `empty` as *skipped* and
 * `failed` as *failed*. Collapsing the two would either spam the log for listings that
 * simply have no text, or hide real breakage inside a skip count.
 */
export type EmbeddingOutcome =
  | { status: "embedded"; embedding: number[] }
  | { status: "empty" }
  | { status: "failed"; error: unknown };

/**
 * Computes a listing's vector.
 *
 * **Never throws.** AI-4's technical note is explicit: an embedding failure must not fail
 * the write. A seller losing their listing because Transformers.js threw is a far worse
 * outcome than a listing that is temporarily unsearchable by meaning — it is still fully
 * keyword-searchable, and the backfill will catch it.
 *
 * Absorbing the failure here rather than in each route means `POST` and `PUT` cannot get
 * it subtly differently. AI-2 propagates so that this layer can decide; this is the layer.
 */
export async function computeListingEmbedding(
  listing: EmbeddableListing,
): Promise<EmbeddingOutcome> {
  const text = buildEmbeddingText(listing);
  // AC7: never send an empty string to the model.
  if (!text) return { status: "empty" };

  try {
    return { status: "embedded", embedding: await getEmbeddingProvider().embed(text) };
  } catch (error) {
    // The caller logs, because only it knows the listing id (AC2).
    return { status: "failed", error };
  }
}
