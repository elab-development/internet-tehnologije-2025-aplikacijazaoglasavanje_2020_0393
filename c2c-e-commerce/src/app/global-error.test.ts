/**
 * global-error.tsx replaces the root layout when it renders, so none of the app's
 * providers, fonts or components are mounted. An import from @/ would resolve fine in
 * a test and fail only in production, during the crash this file exists to handle —
 * so the constraint is asserted against the source rather than the rendered output.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("global-error.tsx stays dependency-free", () => {
  const source = readFileSync("src/app/global-error.tsx", "utf8");

  it("imports nothing from the app", () => {
    const appImports = source.match(/^\s*import\s[^;]*from\s+["']@\//gm) ?? [];
    expect(appImports).toEqual([]);
  });

  it("imports nothing at all beyond the client directive", () => {
    // Stricter than the rule strictly requires, and deliberately so: a relative import
    // would be just as fatal as an aliased one, and this file has no legitimate need
    // for either.
    const allImports = source.match(/^\s*import\s/gm) ?? [];
    expect(allImports).toEqual([]);
  });

  it("renders its own document shell", () => {
    expect(source).toMatch(/<html/);
    expect(source).toMatch(/<body/);
  });
});
