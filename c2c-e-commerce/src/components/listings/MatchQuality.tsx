"use client";

/**
 * C2C-AI-8 — the match-quality indicator.
 *
 * SPEC PHASE SKELETON.
 */
export type MatchQualityProps = {
  /** Cosine similarity from AI-7. Absent when the row never reached the vector arm. */
  similarity?: number;
};

export default function MatchQuality(
  _props: MatchQualityProps,
): React.ReactElement | null {
  throw new Error("not implemented — C2C-AI-8 is in its spec phase");
}
