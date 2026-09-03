/**
 * Weakest proof in the plan, and deliberately labelled as such (spec 7.4): jsdom has
 * no CSS engine, so the media query cannot be executed. This asserts the block exists
 * and covers the animations the app actually ships.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

describe("prefers-reduced-motion", () => {
  it("has a reduce block", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("neutralises the shimmer, which otherwise animates indefinitely", () => {
    // Scoped to the `.skeleton-shimmer` rule itself, not the whole reduce block: the
    // universal `*, *::before, *::after { animation-iteration-count: 1 !important; }`
    // rule a few lines above also matches a looser "animation...1" regex, so a version
    // of this assertion that searched the whole block would still pass even if the
    // shimmer-specific override were deleted -- which defeats the point of the test.
    const block = css.slice(css.indexOf("prefers-reduced-motion"));
    const shimmerIndex = block.indexOf(".skeleton-shimmer");
    expect(shimmerIndex).toBeGreaterThan(-1);
    const shimmerRule = block.slice(shimmerIndex);
    expect(shimmerRule).toMatch(/animation:\s*none/);
  });

  it("stops smooth scrolling", () => {
    const block = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(block).toMatch(/scroll-behavior:\s*auto/);
  });
});
