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
    const t7 = sectionOf(threatModel, "T7");
    expect(t7).toMatch(/skipped entirely/i);
  });

  it("no longer lists the password-change gap as a limitation", () => {
    // Closed by the revocation in the password-change handler.
    expect(sectionOf(threatModel, "4")).not.toMatch(/refresh famil(y|ies) .* remain/i);
  });

  it("lists CSP as partially applied rather than absent", () => {
    expect(sectionOf(threatModel, "4")).toMatch(/frame-ancestors/);
  });

  it("records HSTS, Referrer-Policy and X-Content-Type-Options as applied", () => {
    const section = sectionOf(threatModel, "4");
    expect(section).toMatch(/Strict-Transport-Security|HSTS/);
    expect(section).toMatch(/Referrer-Policy/);
    expect(section).toMatch(/X-Content-Type-Options/);
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
    expect(t4).toMatch(/C1/);
    expect(t4).toMatch(/U\+0080/i);
  });
});

describe("the RBAC matrix matches the routes", () => {
  it("does not describe /similar as unconditionally public", () => {
    const row = rowFor(rbacMatrix, "/similar");
    expect(row).toMatch(/owner|admin/i);
  });

  it("records that /orders/seller projects the buyer's email", () => {
    expect(rowFor(rbacMatrix, "/orders/seller")).toMatch(/buyerEmail/);
  });

  it("records the migration 0013 data loss as a lesson", () => {
    expect(rbacMatrix).toMatch(/0013/);
    expect(rbacMatrix).toMatch(/0015|0017|0019/);
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

/** The one row of a markdown table (matrix or limitations) whose text mentions `needle`. */
function rowFor(markdown: string, needle: string): string {
  return markdown.split("\n").find((l) => l.startsWith("| ") && l.includes(needle)) ?? "";
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
