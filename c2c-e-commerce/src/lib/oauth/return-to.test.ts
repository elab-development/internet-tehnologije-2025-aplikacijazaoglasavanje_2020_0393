/**
 * C2C-SEC-7 AC10 — open-redirect protection for `returnTo`.
 *
 * Written after a security review found this guard applied on the server and *not* on
 * the client: `/link-account` read `returnTo` straight from the query string and handed
 * it to `window.location.assign`. The predicate was fine; the call site was missing. So
 * these tests pin the predicate directly, rather than only through the routes that
 * happen to use it.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_RETURN_TO, safeReturnTo } from "./return-to";

describe("C2C-SEC-7 AC10 — accepted destinations", () => {
  it("keeps an ordinary same-site path", () => {
    expect(safeReturnTo("/listings/5")).toBe("/listings/5");
    expect(safeReturnTo("/")).toBe("/");
  });

  it("keeps a path with a query string and fragment", () => {
    expect(safeReturnTo("/listings?mode=semantic#top")).toBe(
      "/listings?mode=semantic#top",
    );
  });
});

describe("C2C-SEC-7 AC10 — rejected destinations", () => {
  const hostile = [
    "https://evil.test/steal",
    "http://evil.test",
    // Protocol-relative: the browser reads this as an absolute URL.
    "//evil.test/steal",
    // Some parsers normalise the backslash into a slash, giving the above.
    "/\\evil.test",
    "\\\\evil.test",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    // A leading tab is stripped before parsing, exposing the protocol-relative form.
    "\t//evil.test",
    "\n/\\evil.test",
    " //evil.test",
    // Not a path at all.
    "evil.test",
    "listings/5",
  ];

  for (const value of hostile) {
    it(`falls back to the default for ${JSON.stringify(value)}`, () => {
      expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
    });
  }

  it("falls back for absent input", () => {
    expect(safeReturnTo(null)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("")).toBe(DEFAULT_RETURN_TO);
  });

  it("never returns anything that is not a same-site path", () => {
    // The property behind every case above: whatever comes out, a browser must resolve
    // it against this origin.
    for (const value of [...hostile, null, undefined, ""]) {
      const result = safeReturnTo(value);
      expect(result.startsWith("/")).toBe(true);
      expect(result.startsWith("//")).toBe(false);
      expect(result.startsWith("/\\")).toBe(false);
    }
  });
});

describe("safeReturnTo character handling", () => {
  // The old predicate was written with raw control bytes instead of escapes -- a
  // literal NUL, a literal DEL, and the text `\s` -- which is why it read as `/[ -\s]/`
  // to the eye. It never rejected a hyphen: the `-` sat between two raw control bytes
  // and was a range operator there, not a literal character. What it actually missed
  // was the C1 block (U+0080-U+009F), which the fixed predicate now covers.
  it("accepts an ordinary path containing a hyphen", () => {
    expect(safeReturnTo("/link-account")).toBe("/link-account");
    expect(safeReturnTo("/listings/new-item")).toBe("/listings/new-item");
  });

  it.each([
    ["null", "/a\u0000b"],
    ["bell", "/a\u0007b"],
    ["backspace", "/a\u0008b"],
    ["vertical tab", "/a\u000bb"],
    ["escape", "/a\u001bb"],
    ["delete", "/a\u007fb"],
    ["line separator", "/a\u2028b"],
    ["space", "/a\u0020b"],
    ["no-break space", "/a\u00a0b"],
    ["byte order mark", "/a\ufeffb"],
  ])("rejects a path containing %s", (_label, candidate) => {
    expect(safeReturnTo(candidate)).toBe("/");
  });
});
