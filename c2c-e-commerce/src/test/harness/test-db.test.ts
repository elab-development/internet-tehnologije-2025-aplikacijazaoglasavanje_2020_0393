/**
 * C2C-QA-3 spec — how the harness decides where the test database comes from.
 *
 * AC1 and AC2 are about a *choice*, so the choice is a pure function and gets fast unit
 * tests. Whether the container then really starts and really migrates is AC3's job, in
 * `test-db.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { TEST_DB_IMAGE, resolveTestDatabaseSource } from "../db";

describe("C2C-QA-3 — choosing a test database", () => {
  it("AC1: with no TEST_DATABASE_URL, it starts a container", () => {
    const source = resolveTestDatabaseSource({});
    expect(source.kind).toBe("container");
  });

  it("AC1: the container image is pgvector, not plain postgres", () => {
    // Decision D6. A plain postgres image has no `vector` extension to enable, so AI-3's
    // migration 0005 would fail and every AI integration test with it.
    const source = resolveTestDatabaseSource({});
    expect(source).toEqual({ kind: "container", image: TEST_DB_IMAGE });
    expect(TEST_DB_IMAGE).toBe("pgvector/pgvector:pg16");
  });

  it("AC2: with TEST_DATABASE_URL set, it uses that database and starts nothing", () => {
    const url = "postgresql://ci:ci@127.0.0.1:5432/c2c_test";
    const source = resolveTestDatabaseSource({ TEST_DATABASE_URL: url });

    expect(source).toEqual({ kind: "external", url });
  });

  it("AC2: a blank TEST_DATABASE_URL is treated as unset, not as an empty DSN", () => {
    // An unset CI variable expands to "", and connecting to "" fails in a way that looks
    // nothing like "you forgot to configure the service container".
    expect(resolveTestDatabaseSource({ TEST_DATABASE_URL: "" }).kind).toBe("container");
    expect(resolveTestDatabaseSource({ TEST_DATABASE_URL: "   " }).kind).toBe("container");
  });

  it("AC2: surrounding whitespace is trimmed from a real URL", () => {
    const source = resolveTestDatabaseSource({
      TEST_DATABASE_URL: "  postgresql://ci:ci@127.0.0.1:5432/c2c_test\n",
    });
    expect(source).toEqual({
      kind: "external",
      url: "postgresql://ci:ci@127.0.0.1:5432/c2c_test",
    });
  });
});
