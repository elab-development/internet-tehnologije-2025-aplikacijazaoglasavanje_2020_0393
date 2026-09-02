/**
 * C2C-AI-8 spec — AC3, the match-quality indicator.
 *
 * Shown only when the API returned a `similarity`. In hybrid mode a row that reached the
 * results through the keyword arm alone has none, and AI-7 deliberately omits the field
 * rather than sending 0 — so "no indicator" is the honest rendering, not a missing feature.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MatchQuality from "./MatchQuality";

describe("C2C-AI-8 — AC3: when the indicator appears", () => {
  it("AC3: renders nothing when there is no similarity", () => {
    const { container } = render(<MatchQuality />);
    expect(container).toBeEmptyDOMElement();
  });

  it("AC3: renders nothing for an undefined similarity", () => {
    const { container } = render(<MatchQuality similarity={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("AC3: renders an indicator when a similarity is present", () => {
    render(<MatchQuality similarity={0.82} />);
    expect(screen.getByText(/match/i)).toBeInTheDocument();
  });
});

describe("C2C-AI-8 — AC3: what the indicator says", () => {
  it("AC3: describes a strong match as strong", () => {
    render(<MatchQuality similarity={0.85} />);
    expect(screen.getByText(/strong match/i)).toBeInTheDocument();
  });

  it("AC3: describes a middling match as a partial one", () => {
    render(<MatchQuality similarity={0.5} />);
    expect(screen.getByText(/partial match/i)).toBeInTheDocument();
  });

  it("AC3: describes a weak match as loose", () => {
    render(<MatchQuality similarity={0.3} />);
    expect(screen.getByText(/loose match/i)).toBeInTheDocument();
  });

  it("AC3: exposes the raw score to assistive technology, not just on hover", () => {
    // A word alone hides the ordering the ranking is built on; the number is the evidence.
    // L26: a `title` attribute on a non-focusable span was unreachable by keyboard and
    // unread by most screen readers, so the score lives in the accessible name instead.
    render(<MatchQuality similarity={0.826} />);
    expect(screen.getByRole("img", { name: /83% match/i })).toBeInTheDocument();
  });

  it("AC3: clamps a similarity above 1 rather than reporting 120%", () => {
    render(<MatchQuality similarity={1.2} />);

    // Asserted as the clamped value rather than "not 1xx%", which also rejects the
    // correct answer of 100%.
    expect(screen.getByRole("img", { name: /^100% match/i })).toBeInTheDocument();
  });

  it("AC3: treats a zero similarity as present, not absent", () => {
    // 0 is a score AI-7 could in principle return; only `undefined` means "not compared".
    render(<MatchQuality similarity={0} />);
    expect(screen.getByText(/match/i)).toBeInTheDocument();
  });
});

describe("L26 — the score is in the accessible name, not a title attribute", () => {
  it("puts the score in the accessible name, not a title attribute", () => {
    // The brief's snippet for this test used a `score` prop; the component's actual prop
    // is `similarity` (see MatchQualityProps above), so this renders against the real
    // signature rather than the brief's paraphrase.
    render(<MatchQuality similarity={0.82} />);
    // A title on a non-focusable span is unreachable by keyboard and unread by most
    // screen readers.
    expect(screen.getByRole("img", { name: /82% match/i })).toBeInTheDocument();
  });

  it("no longer carries a title attribute", () => {
    // Keeping both would read the value twice.
    render(<MatchQuality similarity={0.82} />);
    expect(screen.getByRole("img")).not.toHaveAttribute("title");
  });
});
