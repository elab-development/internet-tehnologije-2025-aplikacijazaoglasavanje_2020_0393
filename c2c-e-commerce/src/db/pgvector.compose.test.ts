/**
 * C2C-AI-3 spec — AC6: `docker compose -f docker-compose.dev.yml up` needs no manual step.
 *
 * Opt-in, because it starts the real compose stack:
 *
 *   RUN_COMPOSE_TESTS=1 npm run test:unit -- src/db/pgvector.compose.test.ts
 *
 * The point of the criterion is that nobody has to shell in and run
 * `CREATE EXTENSION vector` by hand — swapping the image is what makes that true.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_COMPOSE_TESTS === "1";
const REPO_ROOT = path.resolve(__dirname, "../../..");
const COMPOSE_FILE = "docker-compose.dev.yml";

function compose(args: string[], timeoutMs: number): string {
  return execFileSync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("C2C-AI-3 — compose images", () => {
  it("AC6: both compose files pin a pgvector image, not plain postgres", () => {
    // A cheap assertion that runs everywhere, including where Docker is unavailable.
    for (const file of ["docker-compose.yml", "docker-compose.dev.yml"]) {
      const contents = readFileSync(path.join(REPO_ROOT, file), "utf8");
      expect(contents).toMatch(/image:\s*pgvector\/pgvector:pg16/);
      expect(contents).not.toMatch(/image:\s*postgres:16-alpine/);
    }
  });
});

describe.skipIf(!enabled)("C2C-AI-3 — AC6: the dev compose stack", () => {
  afterAll(() => {
    try {
      compose(["down", "-v"], 5 * 60_000);
    } catch {
      // Teardown failure must not mask a test result.
    }
  });

  it("AC6: the db service reaches a healthy state", () => {
    compose(["up", "-d", "db"], 10 * 60_000);

    const state = compose(["ps", "--format", "{{.Service}} {{.Health}}"], 60_000);
    expect(state).toMatch(/db\s+healthy/);
  }, 10 * 60_000);

  it("AC6: the vector extension is available with no manual step", () => {
    const output = compose(
      [
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        "postgres",
        "-d",
        "c2c_ecommerce",
        "-tAc",
        "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'",
      ],
      2 * 60_000,
    );
    expect(output.trim()).toBe("1");
  }, 2 * 60_000);

  it("AC6: the migrate service installs it and exits cleanly", () => {
    compose(["up", "--exit-code-from", "migrate", "migrate"], 10 * 60_000);

    const output = compose(
      [
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        "postgres",
        "-d",
        "c2c_ecommerce",
        "-tAc",
        "SELECT extname FROM pg_extension WHERE extname = 'vector'",
      ],
      2 * 60_000,
    );
    expect(output.trim()).toBe("vector");
  }, 10 * 60_000);
});
