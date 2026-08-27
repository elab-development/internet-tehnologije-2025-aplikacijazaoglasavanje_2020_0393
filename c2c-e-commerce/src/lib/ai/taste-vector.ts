/**
 * C2C-AI-10 — building a taste vector from a user's interactions.
 *
 * SPEC PHASE SKELETON.
 */
const NOT_IMPLEMENTED = "not implemented — C2C-AI-10 is in its spec phase";

export type Interaction =
  | { kind: "ordered"; embedding: number[] | null }
  | { kind: "reviewed"; embedding: number[] | null; rating: number };

/** Relative influence of each kind of interaction. */
export const INTERACTION_WEIGHTS = {
  /** Buying something is weak evidence you liked it. */
  ordered: 0.6,
  /** Rating it four or five stars is strong evidence. */
  reviewedPositive: 1,
  /** A middling rating is ordinary interest. */
  reviewedNeutral: 0.6,
} as const;

/** Cap on history length, so the vector stays responsive to recent taste. */
export const MAX_INTERACTIONS = 50;

/**
 * A unit vector describing what the user seems to like, or null when there is nothing to
 * build one from — which is the signal to fall back to a popular list.
 */
export function buildTasteVector(_interactions: Interaction[]): number[] | null {
  throw new Error(NOT_IMPLEMENTED);
}
