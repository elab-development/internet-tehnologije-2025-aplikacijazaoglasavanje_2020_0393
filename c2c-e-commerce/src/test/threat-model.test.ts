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
  ];

  it("covers all nine", () => {
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
    const section = threatModel.split("## 4. Known limitations")[1]?.split("## 5.")[0] ?? "";

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
    const section = threatModel.split("## 4. Known limitations")[1]?.split("## 5.")[0] ?? "";
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function mermaidBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
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
