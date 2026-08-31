/**
 * C2C-AI-4 spec — the text that gets embedded.
 *
 * `buildEmbeddingText` has one definition used by both the write path and the backfill, so
 * the two can never disagree about what a listing's vector represents. If they did, a
 * backfilled row and a freshly written one would sit in different places in the same
 * vector space, and nothing downstream would reveal it.
 */
import { describe, expect, it } from "vitest";

import { buildEmbeddingText, needsReembedding } from "./listing-embedding";

describe("C2C-AI-4 — buildEmbeddingText", () => {
  it("joins the title and description with a blank line", () => {
    expect(
      buildEmbeddingText({ title: "Mountain bike", description: "Rides well." }),
    ).toBe("Mountain bike\n\nRides well.");
  });

  it("AC7: a whitespace-only title falls back to the description alone", () => {
    expect(
      buildEmbeddingText({ title: "   ", description: "Rides well." }),
    ).toBe("Rides well.");
  });

  it("AC7: an empty title falls back to the description alone", () => {
    expect(buildEmbeddingText({ title: "", description: "Rides well." })).toBe(
      "Rides well.",
    );
  });

  it("AC7: a whitespace-only description falls back to the title alone", () => {
    expect(buildEmbeddingText({ title: "Mountain bike", description: "  \n " })).toBe(
      "Mountain bike",
    );
  });

  it("AC7: both blank yields an empty string, so the caller can skip the embed call", () => {
    // The signal that there is nothing to embed. AC7 forbids sending an empty string to
    // the model, and this is how the write path knows not to.
    expect(buildEmbeddingText({ title: "  ", description: "" })).toBe("");
  });

  it("AC7: trims surrounding whitespace rather than embedding it", () => {
    expect(
      buildEmbeddingText({ title: "  Mountain bike \n", description: "\tRides well.  " }),
    ).toBe("Mountain bike\n\nRides well.");
  });

  it("is stable for the same input, so a backfill cannot drift from the write path", () => {
    const listing = { title: "Mountain bike", description: "Rides well." };
    expect(buildEmbeddingText(listing)).toBe(buildEmbeddingText(listing));
  });

  it("preserves interior formatting, which carries meaning the model can use", () => {
    expect(
      buildEmbeddingText({ title: "Bike", description: "26 inch wheels\nAluminium frame" }),
    ).toBe("Bike\n\n26 inch wheels\nAluminium frame");
  });
});

describe("C2C-AI-4 — needsReembedding", () => {
  const current = { title: "Mountain bike", description: "Rides well." };

  it("AC3: a changed title requires re-embedding", () => {
    expect(needsReembedding(current, { title: "Road bike" })).toBe(true);
  });

  it("AC3: a changed description requires re-embedding", () => {
    expect(needsReembedding(current, { description: "Needs a new chain." })).toBe(true);
  });

  it("AC4: a changed price does not", () => {
    expect(needsReembedding(current, { price: "150.00" })).toBe(false);
  });

  it("AC4: a changed status or categoryId does not", () => {
    expect(needsReembedding(current, { status: "sold" })).toBe(false);
    expect(needsReembedding(current, { categoryId: 7 })).toBe(false);
  });

  it("AC4: resubmitting the identical title does not count as a change", () => {
    // Presence in the payload is not the test — the value is. A client that PATCHes the
    // whole object every time would otherwise re-embed on every save.
    expect(needsReembedding(current, { title: "Mountain bike" })).toBe(false);
  });

  it("AC4: resubmitting the identical title and description does not count as a change", () => {
    expect(needsReembedding(current, { ...current, price: "150.00" })).toBe(false);
  });

  it("AC4: an empty update does not", () => {
    expect(needsReembedding(current, {})).toBe(false);
  });

  it("AC3: a title differing only in surrounding whitespace does not count", () => {
    // buildEmbeddingText trims, so the embedded text would be identical — re-embedding
    // would burn time to store the same vector.
    expect(needsReembedding(current, { title: "  Mountain bike  " })).toBe(false);
  });
});
