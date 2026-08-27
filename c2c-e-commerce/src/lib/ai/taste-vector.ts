/**
 * C2C-AI-10 — building a taste vector from a user's interactions.
 *
 * Per decision D4 this uses only data the database already has: what the user ordered and
 * what they reviewed. There is no `listing_views` table and none is introduced.
 */
import { EMBEDDING_DIMENSIONS } from "./embeddings";

export type Interaction =
  | { kind: "ordered"; embedding: number[] | null }
  | { kind: "reviewed"; embedding: number[] | null; rating: number };

/**
 * Relative influence of each kind of interaction.
 *
 * The story asks for one of three treatments of a badly reviewed listing — a negative
 * contribution, exclusion, or nothing — to be picked and justified. **Excluded, weight 0.**
 *
 * A negative weight sounds more expressive and is worse. Embeddings encode *topic*, not
 * sentiment: subtracting the vector of a bicycle someone disliked pushes the taste vector
 * away from bicycles in general, so one bad experience with a bike would silently suppress
 * every bike. That is not what a one-star review means. Excluding it says "this tells me
 * nothing about what you want next", which is the honest reading.
 */
export const INTERACTION_WEIGHTS = {
  /** Buying something is weak evidence you liked it. */
  ordered: 0.6,
  /** Rating it four or five stars is strong evidence. */
  reviewedPositive: 1,
  /** A middling rating is ordinary interest — the same as a purchase. */
  reviewedNeutral: 0.6,
} as const;

/** Cap on history length, so the vector stays responsive to recent taste. */
export const MAX_INTERACTIONS = 50;

function weightOf(interaction: Interaction): number {
  if (interaction.kind === "ordered") return INTERACTION_WEIGHTS.ordered;
  if (interaction.rating >= 4) return INTERACTION_WEIGHTS.reviewedPositive;
  if (interaction.rating >= 3) return INTERACTION_WEIGHTS.reviewedNeutral;
  return 0;
}

/**
 * A unit vector describing what the user seems to like, or `null` when there is nothing to
 * build one from.
 *
 * `null` rather than a zero vector: AC2 (no history) and AC6 (history with no embeddings)
 * both end in "fall back to a popular list", and a caller cannot tell an all-zero vector
 * from a real one without re-deriving why it is zero. This makes the cold start a branch
 * rather than an accident.
 */
export function buildTasteVector(interactions: Interaction[]): number[] | null {
  // Callers already order by date descending and limit, but the cap is enforced here too
  // so it holds however the history arrives. The most *recent* interactions win: taste
  // from six months ago should not outvote last week's.
  const recent = interactions.slice(-MAX_INTERACTIONS);

  const sum = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  let totalWeight = 0;

  for (const interaction of recent) {
    const { embedding } = interaction;
    // Skipped, not treated as zero: a zero vector would drag the mean towards the origin
    // and quietly flatten the ranking.
    if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) continue;

    const weight = weightOf(interaction);
    if (weight === 0) continue;

    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      sum[i] += embedding[i] * weight;
    }
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;

  // Re-normalise: averaging unit vectors does not yield a unit vector, and a non-unit
  // taste vector still ranks correctly while reporting similarities that cannot be
  // compared with AI-7's or AI-9's.
  const mean = sum.map((value) => value / totalWeight);
  const norm = Math.sqrt(mean.reduce((acc, value) => acc + value * value, 0));
  if (norm === 0) return null;

  return mean.map((value) => value / norm);
}
