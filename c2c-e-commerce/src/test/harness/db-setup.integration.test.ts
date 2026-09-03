/**
 * C2C-QA-2 spec — AC6: an `.integration.test.ts` file runs only after the DB setup file.
 *
 * The setup file is a stub in QA-2; C2C-QA-3 replaces its body with the real
 * Testcontainers / service-container harness. The contract asserted here — the setup
 * runs before any integration test — is what QA-3 builds on, so it stays as-is.
 */
import { describe, expect, it } from "vitest";

describe("C2C-QA-2 — integration project", () => {
  it("AC6: the DB setup file ran before this test", () => {
    expect(process.env.C2C_TEST_DB_SETUP).toBe("ready");
  });

  it("AC6: runs in node, not jsdom", () => {
    expect(typeof globalThis.document).toBe("undefined");
  });
});
