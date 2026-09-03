/**
 * C2C-QA-3 spec — AC9: the container is stopped when the run ends, including on a crash.
 *
 * The first half runs everywhere: it asserts the harness leaves Testcontainers' reaper
 * enabled, which is the mechanism that delivers the guarantee when a process dies without
 * unwinding. A teardown hook, by definition, does not run in that case.
 *
 * The second half genuinely SIGKILLs a process that started a container, then counts what
 * is left. It costs a container start, so it is opt-in:
 *
 *   RUN_TEARDOWN_TESTS=1 npm run test:unit -- src/test/harness/container-lifecycle.test.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Imported statically, not with a dynamic import inside the test: src/test/db.ts pulls in
// drizzle, pg and Testcontainers, and paying that inside a 5 s unit-test budget made this
// flaky under a full-suite run.
import { stopTestDatabase } from "../db";

const crashEnabled = process.env.RUN_TEARDOWN_TESTS === "1";
const APP_ROOT = path.resolve(__dirname, "../../..");

function runningTestContainers(): string[] {
  return execFileSync(
    "docker",
    ["ps", "-q", "--filter", "label=org.testcontainers=true"],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
}

describe("C2C-QA-3 — AC9: the reaper is left enabled", () => {
  it("AC9: the harness does not disable Testcontainers' reaper", async () => {
    // Ryuk is what stops a container when the owning process dies without unwinding — a
    // crash, a Ctrl-C, a cancelled CI job. Disabling it would make AC9 depend on a
    // teardown hook that cannot run in those cases.
    expect(process.env.TESTCONTAINERS_RYUK_DISABLED).not.toBe("true");
  });

  it("AC9: the harness exposes a teardown for the ordinary path", () => {
    expect(stopTestDatabase).toBeTypeOf("function");
  });
});

describe.skipIf(!crashEnabled)("C2C-QA-3 — AC9: a crashed process leaves nothing behind", () => {
  it("AC9: a SIGKILLed process that started a container leaves none running", () => {
    const before = runningTestContainers().length;

    // The probe starts a container through the real harness and then SIGKILLs itself, so
    // nothing in our code gets the chance to clean up.
    const result = spawnSync(
      "npx",
      ["tsx", "src/test/harness/ac9-crash-probe.ts"],
      {
        cwd: APP_ROOT,
        encoding: "utf8",
        timeout: 5 * 60_000,
        shell: process.platform === "win32",
      },
    );
    expect(result.stdout).toContain("probe started a database");

    // Ryuk's reap is not instantaneous, so allow a bounded window instead of asserting
    // immediately or sleeping a fixed amount.
    const deadline = Date.now() + 90_000;
    let after = runningTestContainers().length;
    while (after > before && Date.now() < deadline) {
      execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
        encoding: "utf8",
      });
      after = runningTestContainers().length;
    }

    expect(after).toBeLessThanOrEqual(before);
  }, 7 * 60_000);
});
