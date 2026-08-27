"use client";

export type MatchQualityProps = {
  /** Cosine similarity from AI-7. Absent when the row never reached the vector arm. */
  similarity?: number;
};

const STRONG = 0.7;
const PARTIAL = 0.45;

/**
 * C2C-AI-8 — how well a listing matched the query.
 *
 * Rendered only when the API returned a similarity. In hybrid mode a row that arrived
 * through the keyword arm has none, and AI-7 omits the field rather than sending 0 — so
 * showing nothing is the honest rendering, not a gap. A similarity of exactly 0 is a real
 * score and does render; only `undefined` means "never compared".
 */
export default function MatchQuality({
  similarity,
}: MatchQualityProps): React.ReactElement | null {
  if (similarity === undefined) return null;

  const score = Math.min(1, Math.max(0, similarity));
  const percent = Math.round(score * 100);

  const label =
    score >= STRONG ? "Strong match" : score >= PARTIAL ? "Partial match" : "Loose match";

  const tone =
    score >= STRONG
      ? "bg-emerald-50 text-emerald-700"
      : score >= PARTIAL
        ? "bg-amber-50 text-amber-700"
        : "bg-zinc-100 text-zinc-600";

  return (
    <span
      // The number as well as the word: a label alone hides the ordering the ranking is
      // built on, and this is the thesis's evidence surface.
      title={`${percent}% similar to your search`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
