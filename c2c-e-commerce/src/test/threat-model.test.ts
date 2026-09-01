/**
 * C2C-SEC-12 AC1/AC2/AC3/AC5 — the threat model has to stay true.
 *
 * A security document rots faster than the code it describes: a test gets renamed, a
 * mitigation moves, and the document keeps claiming something a reviewer can no longer
 * check. AC5 says every claimed mitigation must be verifiable against a real test, so
 * this asserts that the files it names actually exist and that the diagrams say what the
 * story requires.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "../..");
const DOCS = path.resolve(APP_ROOT, "../docs/security");

const threatModel = readFileSync(path.join(DOCS, "threat-model.md"), "utf8");
const rbacMatrix = readFileSync(path.join(DOCS, "rbac-matrix.md"), "utf8");

describe("C2C-SEC-12 AC1 — every threat names a mitigation", () => {
  const THREATS = [
    "Token theft via XSS",
    "Refresh-token theft",
    "Cross-site request forgery",
    "Open redirect",
    "Account takeover via unverified email",
    "Privilege escalation",
    "Brute force",
    "OAuth `state` and PKCE replay",
    "Information disclosure",
    "Malicious file upload",
  ];

  it("covers all ten", () => {
    for (const threat of THREATS) {
      expect(threatModel, threat).toContain(threat);
    }
  });

  it("gives each one a Mitigation and a Proof", () => {
    // Counting rather than parsing: one of each per threat section.
    const mitigations = threatModel.match(/\*\*Mitigations?\.\*\*/g) ?? [];
    const proofs = threatModel.match(/\*\*Proof\.\*\*/g) ?? [];

    expect(mitigations.length).toBe(THREATS.length);
    expect(proofs.length).toBe(THREATS.length);
  });
});

describe("C2C-SEC-12 AC5 — every named test file exists", () => {
  /** Every `something.test.ts(x)` the document cites as proof. */
  const cited = [
    ...new Set(
      (threatModel.match(/`[\w./[\]-]+\.(?:test|integration\.test|component\.test)\.tsx?`/g) ?? [])
        .map((m) => m.slice(1, -1)),
    ),
  ];

  it("cites at least one test per threat", () => {
    expect(cited.length).toBeGreaterThanOrEqual(9);
  });

  it.each(cited)("%s exists in the suite", (name) => {
    // Cited by basename, so resolve by searching rather than by literal path.
    const base = path.basename(name);
    const found = findFile(path.join(APP_ROOT, "src"), base);

    expect(found, `${base} is cited in threat-model.md but does not exist`).toBe(true);
  });
});

describe("C2C-SEC-12 AC5 — every named source file exists", () => {
  const cited = [
    ...new Set(
      (threatModel.match(/`src\/[\w./[\]-]+\.ts`/g) ?? []).map((m) => m.slice(1, -1)),
    ),
  ];

  it.each(cited)("%s exists", (relative) => {
    expect(
      existsSync(path.join(APP_ROOT, relative)),
      `${relative} is cited in threat-model.md but does not exist`,
    ).toBe(true);
  });
});

describe("C2C-SEC-12 AC2 — the PKCE diagram", () => {
  const diagram = mermaidBlocks(threatModel)[0] ?? "";

  it("renders on GitHub as a mermaid sequence diagram", () => {
    // GitHub renders ```mermaid fences natively; anything else is a code block.
    expect(threatModel).toContain("```mermaid");
    expect(diagram).toContain("sequenceDiagram");
  });

  it("shows that GitHub's flow omits code_challenge", () => {
    expect(diagram).toMatch(/GitHub.*NO PKCE/i);
    expect(diagram).toMatch(/No code_challenge parameter exists/i);
  });

  it("shows Google sending the challenge", () => {
    expect(diagram).toMatch(/Google.*supports PKCE/i);
    expect(diagram).toContain("code_challenge");
  });

  it("records that no secret travels in the redirect URL", () => {
    expect(diagram).toMatch(/No token, code or secret in the URL/i);
  });
});

describe("C2C-SEC-12 AC3 — the rotation diagram", () => {
  const diagram = mermaidBlocks(threatModel)[1] ?? "";

  it("is a second sequence diagram", () => {
    expect(diagram).toContain("sequenceDiagram");
  });

  it("shows the happy path minting a successor", () => {
    expect(diagram).toMatch(/INSERT successor/i);
    expect(diagram).toMatch(/replaced_by_id/);
  });

  it("shows the reuse branch revoking the whole family", () => {
    expect(diagram).toMatch(/REUSE DETECTED/i);
    expect(diagram).toMatch(/every token in family|UPDATE every token in family/i);
  });

  it("records that the revocation runs outside the transaction", () => {
    // The subtlety the AC6 test caught; losing it from the diagram would lose the
    // reason the code is shaped this way.
    expect(diagram).toMatch(/OUTSIDE the transaction/i);
  });

  it("distinguishes a concurrent race from theft", () => {
    expect(diagram).toMatch(/Not treated as theft/i);
  });
});

describe("C2C-SEC-12 AC4 — known limitations", () => {
  it("names every limitation's disposition", () => {
    const section = sectionOf(threatModel, "4");

    for (const limitation of [
      "in-memory and per instance",
      "No 2FA",
      "email_verified",
      "No email verification flow",
      "Content-Security-Policy",
      "session-management UI",
    ]) {
      expect(section, limitation).toContain(limitation);
    }
  });

  it("says whether each is deferred or accepted", () => {
    const section = sectionOf(threatModel, "4");
    const rows = section.split("\n").filter((l) => l.startsWith("| ") && !l.includes("---"));

    // Header plus at least six entries, each stating a disposition.
    expect(rows.length).toBeGreaterThan(6);
    for (const row of rows.slice(1)) {
      expect(row, row).toMatch(/Deferred|Accepted|Correct|Not in this backlog/i);
    }
  });
});

describe("C2C-SEC-12 — the RBAC matrix is linked and present", () => {
  it("links the matrix from the threat model", () => {
    expect(threatModel).toContain("rbac-matrix.md");
  });

  it("documents the 404-over-403 rule", () => {
    expect(rbacMatrix).toMatch(/404 replaces 403|404 over 403/i);
  });

  it("documents that authorisation is decided before state", () => {
    expect(rbacMatrix).toMatch(/before it checks whether|decided before state/i);
  });
});

/**
 * api-remediation Task 21 — the documents have to keep saying what is true.
 *
 * Twenty tasks changed the ground under these two documents: the rate limiter learned a
 * trusted-proxy hop count and per-account keys, `safeReturnTo`'s control-character
 * predicate turned out to have been misdiagnosed by an earlier review, a password change
 * now revokes every refresh family, a narrow CSP shipped, and two RBAC rows fell out of
 * date with the routes they describe. These tests pin the corrected claims so a future
 * edit that reintroduces a stale or false one fails here rather than surviving to be
 * trusted by a reader.
 */
describe("the threat model describes the limiter that exists", () => {
  it("names the trusted-hop model rather than implying raw XFF is trusted", () => {
    const t7 = sectionOf(threatModel, "T7");
    expect(t7).toMatch(/TRUSTED_PROXY_HOPS/);
    // The old text described sliding-window limits without mentioning that the key was
    // client-controlled. Naming the variable is what makes the claim checkable.
  });

  it("documents that IP-keyed limits are skipped, not shared, at zero trusted hops", () => {
    // The alternative -- a shared fallback bucket -- would let one abuser lock out every
    // caller, which is the actual reason the limit is skipped rather than degraded.
    // Pinned as one phrase, not just the words "skipped entirely" in isolation: "are NOT
    // skipped entirely" would still satisfy a bare substring match on that fragment.
    const t7 = sectionOf(threatModel, "T7");
    expect(t7).toMatch(phrase("IP-keyed limits are skipped entirely"));
  });

  it("no longer lists the password-change gap as a limitation", () => {
    // Closed by the revocation in the password-change handler.
    expect(sectionOf(threatModel, "4")).not.toMatch(/refresh famil(y|ies) .* remain/i);
  });

  it("lists CSP as partially applied, tied to a stated 'applied' status", () => {
    // A bare /frame-ancestors/ match would also pass "frame-ancestors is NOT applied" --
    // require the term and an unnegated "applied" verdict in the same table row.
    const row = rowFor(threatModel, "Content-Security-Policy");
    expect(row).toMatch(/frame-ancestors/);
    expect(row).toMatch(phrase("frame-ancestors 'none'` is applied"));
    expect(row).not.toMatch(/frame-ancestors[^|]*\bnot\s+(?:yet\s+)?applied\b/i);
  });

  it("records HSTS, Referrer-Policy and X-Content-Type-Options as applied", () => {
    // Same row as the CSP claim above (one markdown table line). Requiring the shared
    // "are already applied on every route" verdict alongside all three names means a
    // rewrite that carves one header out into its own "is not yet applied" clause changes
    // this same row and trips the negative guard below, whichever header it targets.
    const row = rowFor(threatModel, "Content-Security-Policy");
    expect(row).toMatch(/HSTS|Strict-Transport-Security/i);
    expect(row).toMatch(/Referrer-Policy/);
    expect(row).toMatch(/X-Content-Type-Options/);
    expect(row).toMatch(phrase("are already applied on every route"));
    expect(row).not.toMatch(/not\s+(?:yet\s+)?applied\b|isn't\s+applied|is\s+not\s+applied/i);
  });
});

describe("the threat model's T4 does not repeat the disproven hyphen claim", () => {
  const t4 = sectionOf(threatModel, "T4");

  it("does not claim the old predicate rejected an ordinary hyphenated path", () => {
    // The finding that /link-account was rejected by the character predicate was itself
    // wrong -- the hyphen sat between two raw control bytes and was a range operator, not
    // a literal. This is the specific false claim that must not survive in the document.
    expect(t4).not.toMatch(/rejected `?\/link-account`?/i);
  });

  it("names the actual gap the fixed predicate closed", () => {
    // Bare /C1/ and /U\+0080/i checks would also pass a rewrite claiming the C1 block was
    // *already* covered and so was never the gap. Pin the verdict, not just the term.
    expect(t4).toMatch(phrase("gap was the C1 block"));
    expect(t4).toMatch(/U\+0080/i);
  });
});

describe("the RBAC matrix matches the routes", () => {
  it("does not describe /similar as unconditionally public", () => {
    // A bare /owner|admin/i match would also pass "no owner-or-admin restriction, fully
    // public" -- pin the clause that ties the restriction to the images route it mirrors.
    const row = rowFor(rbacMatrix, "/similar");
    expect(row).toMatch(phrase("owner-or-admin, matching `GET /api/images/{id}`"));
  });

  it("records that /orders/seller projects the buyer's email", () => {
    // A bare /buyerEmail/ match would also pass "never includes buyerEmail" -- pin the
    // verb next to the field name so a negated rewrite breaks the match.
    expect(rowFor(rbacMatrix, "/orders/seller")).toMatch(
      phrase("projects the buyer's `buyerEmail`"),
    );
  });

  /**
   * Task 18 renamed three `PUT` handlers to `PATCH` and Task 19 moved an illegal order
   * transition from 400 to 409, and the matrix went on documenting the old shape for both
   * -- four rows describing verbs that now answer 405. The tests above check prose, which
   * is why none of them noticed: nothing was reading the verb column at all.
   *
   * Asserted as the *complete* verb column per route rather than as the presence of the
   * word "PATCH", because a row reading "PUT (deprecated) / PATCH" would satisfy a
   * presence check while still being wrong, and because a rename that drops a row
   * entirely has to fail here too.
   */
  const VERB_ROWS = [
    { path: "/api/categories/{id}", verbs: ["PATCH · DELETE"] },
    { path: "/api/listings/{id}", verbs: ["GET", "PATCH · DELETE"] },
    { path: "/api/users/{id}", verbs: ["GET", "PATCH", "DELETE"] },
    { path: "/api/orders/{id}", verbs: ["GET", "PUT", "DELETE"] },
    { path: "/api/reviews/{id}", verbs: ["PATCH · DELETE"] },
  ];

  it.each(VERB_ROWS)("$path is documented as answering $verbs", ({ path: route, verbs }) => {
    expect(
      matrixRows(route).map((row) => row.verbs),
      `the verb column for ${route} does not match the handlers the route exports`,
    ).toEqual(verbs);
  });

  it("mentions PUT for the one route that still answers it, and no other", () => {
    // The catch-all for the next rename: any row whose verb cell still says PUT has to be
    // the orders row, whatever else changes around it.
    const withPut = matrixRows()
      .filter((row) => /\bPUT\b/.test(row.verbs))
      .map((row) => row.path);

    expect(withPut).toEqual(["`/api/orders/{id}`"]);
  });

  it("records that a listing with order history is withdrawn rather than deleted", () => {
    // `orders.listing_id` is RESTRICT, so DELETE cannot be the hard delete this row used
    // to describe. A bare /removed/ check would also pass "is never moved to `removed`";
    // pin the clause, and refuse a row that calls the delete unconditional.
    const [row] = matrixRows("/api/listings/{id}").filter((r) => r.verbs.includes("DELETE"));

    expect(row.notes).toMatch(phrase("soft-deleted to `removed`"));
    expect(row.notes).toMatch(phrase("hard delete only when no order references"));
  });

  it("records an illegal order transition as a 409", () => {
    // Moved from 400 in Task 19: the body parsed and the status is real, so what is wrong
    // is the resource's state. The negative guard is what makes a half-edited row fail.
    const [row] = matrixRows("/api/orders/{id}").filter((r) => r.verbs === "PUT");

    expect(row.notes).toMatch(phrase("an illegal transition **409**"));
    expect(row.notes).not.toMatch(/illegal transition[^|]*\*\*400\*\*/);
  });

  it("records the migration 0013 data loss as a lesson, not merely the numbers", () => {
    // Citing "0013" alongside "0015|0017|0019" passes even for a garbled rewrite that
    // claims 0013 also raised a notice before deleting. Pin the specific contrast: that
    // 0013 did none of what each later migration is credited with doing.
    expect(rbacMatrix).toMatch(phrase("`0013` did none of that"));
    expect(rbacMatrix).toMatch(phrase("no check, no count"));
    expect(rbacMatrix).toMatch(phrase("`0015_orders_collapse.sql` refuses to run"));
    expect(rbacMatrix).toMatch(
      phrase("`0017_reviews_reanchor.sql` announces the row count with `RAISE NOTICE`"),
    );
    expect(rbacMatrix).toMatch(phrase("`0019_users_email_lower.sql` refuses"));
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function mermaidBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/**
 * Slices out one section of `threat-model.md`: a `### T<n>` threat, by its id (e.g.
 * `"T7"`), or the `## 4. Known limitations` table via the id `"4"`.
 *
 * The existing AC2/AC3 tests read mermaid blocks positionally and AC4 sliced section 4
 * inline; this generalises that same split-on-heading approach rather than adding a
 * second way of reading the document.
 */
function sectionOf(markdown: string, id: string): string {
  if (id === "4") {
    return markdown.split("## 4. Known limitations")[1]?.split("## 5.")[0] ?? "";
  }

  const start = markdown.search(new RegExp(`^### ${id}\\b`, "m"));
  if (start === -1) return "";

  const rest = markdown.slice(start);
  const nextHeading = rest.slice(1).search(/^### /m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading + 1);
}

/**
 * The RBAC matrix's rows, split into cells, optionally narrowed to one route path.
 *
 * `rowFor` below finds the *first* row mentioning a substring, which is exactly wrong for
 * a route with several rows: `/api/users/{id}` has three, and a search for it also matches
 * `/api/users/{id}/reviews`. This matches the path cell in full instead, so each row is
 * attributed to the route that actually owns it.
 */
function matrixRows(routePath?: string): Array<{ path: string; verbs: string; notes: string }> {
  return rbacMatrix
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.includes("---"))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    // Seven columns: path, verbs, auth, buyer, seller, admin, notes. Cell 0 is the empty
    // string before the leading pipe, and the notes run to the trailing one -- rejoined
    // rather than indexed, so a note containing a pipe cannot truncate itself.
    .filter((cells) => cells.length >= 9 && cells[1].startsWith("`/api/"))
    .map((cells) => ({
      path: cells[1],
      verbs: cells[2],
      notes: cells.slice(7, cells.length - 1).join("|"),
    }))
    .filter((row) => routePath === undefined || row.path === `\`${routePath}\``);
}

/** The one row of a markdown table (matrix or limitations) whose text mentions `needle`. */
function rowFor(markdown: string, needle: string): string {
  return markdown.split("\n").find((l) => l.startsWith("| ") && l.includes(needle)) ?? "";
}

/**
 * A case-insensitive regex that matches `text` literally, except any run of whitespace in
 * `text` also matches a markdown line wrap (an ordinary newline, or a newline followed by
 * the couple of spaces a bullet's continuation line is indented with).
 *
 * Pinning an exact multi-word claim -- rather than checking each significant word is
 * present somewhere in the section -- is what makes these assertions fail on an inverted
 * or garbled rewrite instead of passing on a substring match alone.
 */
function phrase(text: string): RegExp {
  const escaped = text
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(escaped, "i");
}

/** Depth-first search for a file by basename. */
function findFile(dir: string, basename: string): boolean {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (findFile(full, basename)) return true;
    } else if (entry === basename) {
      return true;
    }
  }
  return false;
}
