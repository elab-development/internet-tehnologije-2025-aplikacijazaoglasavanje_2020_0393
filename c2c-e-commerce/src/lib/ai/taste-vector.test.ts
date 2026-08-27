/**
 * C2C-AI-10 spec — building a taste vector from interactions.
 *
 * The weighting and the re-normalisation decide the whole ranking, so they are a pure
 * function tested here, where a failure points at the arithmetic rather than at a query.
 */
import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "./embeddings";
import {
  INTERACTION_WEIGHTS,
  MAX_INTERACTIONS,
  buildTasteVector,
  type Interaction,
} from "./taste-vector";
import { cosineSimilarity, l2Norm } from "../../test/vectors";

/** A unit vector pointing along a single axis, so directions are easy to reason about. */
function axis(index: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === index ? 1 : 0));
}

const ordered = (embedding: number[]): Interaction => ({ kind: "ordered", embedding });
const reviewed = (embedding: number[], rating: number): Interaction => ({
  kind: "reviewed",
  embedding,
  rating,
});

describe("C2C-AI-10 — weights", () => {
  it("weights a well-reviewed listing above a merely ordered one", () => {
    // Buying something is weak evidence you liked it; rating it four stars is strong.
    expect(INTERACTION_WEIGHTS.reviewedPositive).toBeGreaterThan(
      INTERACTION_WEIGHTS.ordered,
    );
  });

  it("caps history so the vector stays responsive to recent taste", () => {
    expect(MAX_INTERACTIONS).toBe(50);
  });
});

describe("C2C-AI-10 — buildTasteVector", () => {
  it("returns null when there are no interactions, so the caller can fall back", () => {
    // AC2's cold start is a *decision* the caller makes, not an empty vector to rank with.
    expect(buildTasteVector([])).toBeNull();
  });

  it("returns a unit vector", () => {
    const vector = buildTasteVector([ordered(axis(0)), ordered(axis(1))])!;

    // Averaging unit vectors does not produce a unit vector; re-normalising is what keeps
    // cosine similarity against it meaningful.
    expect(l2Norm(vector)).toBeCloseTo(1, 6);
  });

  it("returns a vector of the right width", () => {
    expect(buildTasteVector([ordered(axis(0))])).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("a single interaction yields that interaction's direction", () => {
    const vector = buildTasteVector([ordered(axis(3))])!;
    expect(cosineSimilarity(vector, axis(3))).toBeCloseTo(1, 6);
  });

  it("AC7: leans towards the direction the user interacted with most", () => {
    // Two cycling purchases against one of something else: the vector must point at
    // cycling, which is exactly what AC7 asserts end to end.
    const vector = buildTasteVector([
      ordered(axis(0)),
      ordered(axis(0)),
      ordered(axis(1)),
    ])!;

    expect(cosineSimilarity(vector, axis(0))).toBeGreaterThan(
      cosineSimilarity(vector, axis(1)),
    );
  });

  it("a good review outweighs an order in the opposite direction", () => {
    const vector = buildTasteVector([ordered(axis(1)), reviewed(axis(0), 5)])!;

    expect(cosineSimilarity(vector, axis(0))).toBeGreaterThan(
      cosineSimilarity(vector, axis(1)),
    );
  });

  it("a poorly reviewed listing does not pull the vector towards itself", () => {
    // Rating something two stars is evidence about taste, and it is not "more of this".
    const withBadReview = buildTasteVector([
      ordered(axis(0)),
      reviewed(axis(1), 1),
    ])!;

    expect(cosineSimilarity(withBadReview, axis(1))).toBeLessThanOrEqual(
      cosineSimilarity(withBadReview, axis(0)),
    );
  });

  it("a mid review counts as ordinary interest rather than enthusiasm", () => {
    const midOnly = buildTasteVector([reviewed(axis(0), 3)])!;
    expect(cosineSimilarity(midOnly, axis(0))).toBeCloseTo(1, 6);
  });

  it("skips interactions with no embedding rather than treating them as zero", () => {
    // A zero vector would drag the mean towards the origin and quietly flatten the ranking.
    const vector = buildTasteVector([
      ordered(axis(0)),
      { kind: "ordered", embedding: null },
    ])!;

    expect(cosineSimilarity(vector, axis(0))).toBeCloseTo(1, 6);
  });

  it("AC6: returns null when every interaction lacks an embedding", () => {
    const vector = buildTasteVector([
      { kind: "ordered", embedding: null },
      { kind: "reviewed", embedding: null, rating: 5 },
    ]);

    // The signal the route needs in order to fall back to "popular" rather than erroring.
    expect(vector).toBeNull();
  });

  it("returns null when every interaction is discounted to nothing", () => {
    expect(buildTasteVector([reviewed(axis(0), 1), reviewed(axis(1), 1)])).toBeNull();
  });

  it("uses only the most recent MAX_INTERACTIONS", () => {
    // Oldest first, so the tail is what should survive the cap.
    const history: Interaction[] = [
      ...Array.from({ length: MAX_INTERACTIONS }, () => ordered(axis(1))),
      ordered(axis(0)),
    ];

    const vector = buildTasteVector(history)!;
    expect(cosineSimilarity(vector, axis(0))).toBeGreaterThan(0);
  });

  it("is deterministic for the same history", () => {
    const history = [ordered(axis(0)), reviewed(axis(1), 5)];
    expect(buildTasteVector(history)).toEqual(buildTasteVector(history));
  });

  it("does not depend on the order interactions are supplied in", () => {
    const a = buildTasteVector([ordered(axis(0)), reviewed(axis(1), 5)])!;
    const b = buildTasteVector([reviewed(axis(1), 5), ordered(axis(0))])!;

    for (const [i, value] of a.entries()) {
      expect(value).toBeCloseTo(b[i], 10);
    }
  });
});
