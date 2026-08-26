/**
 * C2C-QA-3 spec — AC9: the container is stopped when the run ends, including a crash.
 *
 * The normal-exit half runs everywhere: it asserts the harness leaves Testcontainers'
 * reaper enabled, which is the mechanism that actually delivers the guarantee when a run
 * dies without unwinding.
 *
 * The crash half genuinely kills a Vitest process and then counts containers, so it is
 * opt-in:
 *
 *   RUN_TEARDOWN_TESTS=1 npm run test:unit -- src/test/harness/container-lifecycle.test.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
    // Ryuk is what stops a container when the owning process dies without unwinding —
    // a crash, a Ctrl-C, a killed CI job. Disabling it would make AC9 depend on a
    // teardown hook that, by definition, does not run in those cases.
    expect(process.env.TESTCONTAINERS_RYUK_DISABLED).not.toBe("true");

    const { stopTestDatabase } = await import("../db");
    expect(stopTestDatabase).toBeTypeOf("function");
  });
});

describe.skipIf(!crashEnabled)("C2C-QA-3 — AC9: a crashed run leaves nothing behind", () => {
  it("AC9: a Vitest run that dies mid-test leaves no container running", () => {
    const before = runningTestContainers();

    const dir = mkdtempSync(path.join(tmpdir(), "c2c-ac9-"));
    const spec = path.join(dir, "crash.integration.test.ts");
    writeFileSync(
      spec,
      [
        'import { it } from "vitest";',
        'import { getTestDb } from "@/test/db";',
        'it("starts a container, then kills the process", async () => {',
        "  await getTestDb();",
        "  process.kill(process.pid, 'SIGKILL');",
        "});",
        "",
      ].join("\n"),
    );

    try {
      spawnSync(
        "npx",
        ["vitest", "run", "--project", "integration", spec],
        {
          cwd: APP_ROOT,
          encoding: "utf8",
          timeout: 5 * 60_000,
          shell: process.platform === "win32",
        },
      );

      // Ryuk's reap is not instantaneous; give it a bounded window rather than a
      // fixed sleep.
      const deadline = Date.now() + 60_000;
      let after = runningTestContainers();
      while (after.length > before.length && Date.now() < deadline) {
        execFileSync("docker", ["ps", "-q"], { encoding: "utf8" });
        after = runningTestContainers();
      }

      expect(after.length).toBeLessThanOrEqual(before.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 6 * 60_000);
});
