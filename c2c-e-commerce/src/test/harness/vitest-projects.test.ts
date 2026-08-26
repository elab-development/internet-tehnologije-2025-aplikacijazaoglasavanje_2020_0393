/**
 * C2C-QA-2 spec — Vitest projects (unit / integration / component) and coverage config.
 *
 * These tests introspect the real `vitest.config.ts`, which is why every project must be
 * declared as an inline object rather than a glob string or a factory function.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import viteConfig from "../../../vitest.config";

const APP_ROOT = path.resolve(__dirname, "../../..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");

type ProjectConfig = {
  test?: {
    name?: string;
    include?: string[];
    exclude?: string[];
    environment?: string;
    setupFiles?: string[] | string;
    fileParallelism?: boolean;
    testTimeout?: number;
  };
};

const testConfig = viteConfig.test as {
  projects?: unknown[];
  coverage?: {
    provider?: string;
    reporter?: string[];
    include?: string[];
    exclude?: string[];
  };
};

const projects = (testConfig?.projects ?? []) as ProjectConfig[];

function project(name: string): ProjectConfig["test"] {
  const found = projects.find((p) => p?.test?.name === name);
  if (!found) {
    throw new Error(
      `no project named "${name}" in vitest.config.ts (found: ${projects
        .map((p) => p?.test?.name ?? "<unnamed>")
        .join(", ")})`,
    );
  }
  return found.test;
}

function setupFilesOf(name: string): string[] {
  const files = project(name)?.setupFiles;
  if (!files) return [];
  return Array.isArray(files) ? files : [files];
}

describe("C2C-QA-2 — vitest projects", () => {
  it("AC2: declares exactly the unit, integration and component projects", () => {
    const names = projects.map((p) => p?.test?.name);
    expect(names).toEqual(["unit", "integration", "component"]);
  });

  it("AC1: the unit project runs in node with no setup file", () => {
    expect(project("unit")?.environment).toBe("node");
    expect(setupFilesOf("unit")).toEqual([]);
  });

  it("AC1: the unit project collects src/**/*.test.ts but not integration or component tests", () => {
    const unit = project("unit");
    expect(unit?.include).toEqual(["src/**/*.test.ts"]);
    expect(unit?.exclude).toEqual(
      expect.arrayContaining(["**/*.integration.test.ts", "**/*.component.test.tsx"]),
    );
  });

  it("AC1: no database setup has run in the unit project", () => {
    expect(process.env.C2C_TEST_DB_SETUP).toBeUndefined();
  });

  it("AC6: the integration project has a DB setup file, no file parallelism and a longer timeout", () => {
    const integration = project("integration");
    expect(integration?.include).toEqual(["src/**/*.integration.test.ts"]);
    expect(integration?.environment).toBe("node");
    expect(integration?.fileParallelism).toBe(false);
    expect(integration?.testTimeout ?? 0).toBeGreaterThanOrEqual(30_000);

    const setups = setupFilesOf("integration");
    expect(setups).toHaveLength(1);
    expect(readFileSync(path.resolve(APP_ROOT, setups[0]), "utf8")).toContain(
      "C2C_TEST_DB_SETUP",
    );
  });

  it("AC5: the component project runs in jsdom with a testing-library setup file", () => {
    const component = project("component");
    expect(component?.include).toEqual(["src/**/*.component.test.tsx"]);
    expect(component?.environment).toBe("jsdom");

    const setups = setupFilesOf("component");
    expect(setups).toHaveLength(1);
    expect(readFileSync(path.resolve(APP_ROOT, setups[0]), "utf8")).toContain(
      "@testing-library/jest-dom",
    );
  });
});

describe("C2C-QA-2 — coverage configuration", () => {
  it("AC3: uses the v8 provider and emits text, lcov and html reports", () => {
    expect(testConfig?.coverage?.provider).toBe("v8");
    expect(testConfig?.coverage?.reporter).toEqual(
      expect.arrayContaining(["text", "lcov", "html"]),
    );
  });

  it("AC4: measures src/lib and src/app/api", () => {
    expect(testConfig?.coverage?.include).toEqual(
      expect.arrayContaining(["src/lib/**", "src/app/api/**"]),
    );
  });

  it("AC4: excludes test files, the generated swagger spec and the migrate/seed scripts", () => {
    const exclude = testConfig?.coverage?.exclude ?? [];
    expect(exclude).toEqual(
      expect.arrayContaining([
        "**/*.test.ts",
        "**/*.test.tsx",
        "src/lib/swagger-spec.json",
        "src/db/migrate.ts",
        "src/db/seed.ts",
      ]),
    );
  });

  it("AC1/AC2/AC3: npm exposes a script per project plus a coverage run", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(APP_ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts["test:unit"]).toBe("vitest run --project unit");
    expect(pkg.scripts["test:integration"]).toBe("vitest run --project integration");
    expect(pkg.scripts["test:component"]).toBe("vitest run --project component");
    expect(pkg.scripts["test:coverage"]).toBe("vitest run --coverage");
  });

  it("AC7: the coverage directory is git-ignored", () => {
    const appIgnore = readFileSync(path.join(APP_ROOT, ".gitignore"), "utf8");
    const repoIgnore = readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
    const ignored = `${appIgnore}\n${repoIgnore}`
      .split("\n")
      .map((line) => line.trim().replace(/^\/+|\/+$/g, ""));
    expect(ignored).toContain("coverage");
  });
});
