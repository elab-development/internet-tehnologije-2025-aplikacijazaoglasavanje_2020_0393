/**
 * C2C-SEC-1 AC7 — the regression suite runs in CI, not as a manual script.
 *
 * A security regression test that CI never executes is documentation, not a control.
 * This guards the one change that would silently disarm every integration test in the
 * repository: narrowing the CI test step to `test:unit`, which still looks green while
 * skipping every route- and database-level assertion.
 *
 * It is a unit test on purpose — it reads a file and needs no database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const WORKFLOW = path.resolve(__dirname, "../../../.github/workflows/ci.yml");

describe("C2C-SEC-1 AC7 — CI executes the full test suite", () => {
  const ci = readFileSync(WORKFLOW, "utf8");

  it("runs `npm run test`, which covers every vitest project", () => {
    expect(ci).toMatch(/run:\s*npm run test\s*$/m);
  });

  it("does not narrow the test step to a single project", () => {
    // `npm run test:unit` alone would skip the integration project entirely.
    expect(ci).not.toMatch(/run:\s*npm run test:(unit|component)\s*$/m);
  });

  it("still type-checks and lints, so a broken spec cannot merge green", () => {
    expect(ci).toMatch(/npx tsc --noEmit/);
    expect(ci).toMatch(/npm run lint/);
  });
});
