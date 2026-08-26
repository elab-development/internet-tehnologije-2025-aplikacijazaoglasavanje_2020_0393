/**
 * Setup file for the `integration` Vitest project — runs once per test file, before the
 * test module is imported.
 *
 * That ordering is load-bearing. `src/db/index.ts` builds its connection pool from
 * `process.env.DATABASE_URL` at import time, so pointing the variable at the test database
 * has to happen before anything imports `@/db`. Without it, a route handler under test
 * would talk to the developer's real database — which is what makes QA-3 AC6, and every
 * route test QA-5 adds later, possible at all.
 */
import { inject } from "vitest";

const url = inject("testDatabaseUrl");

process.env.DATABASE_URL = url;
// Also set for the harness itself, so a worker resolves the existing database rather than
// starting a container of its own (AC8).
process.env.TEST_DATABASE_URL = url;

// The contract C2C-QA-2's canary asserts: this file ran before any integration test.
process.env.C2C_TEST_DB_SETUP = "ready";

// Route handlers sign and verify real tokens (AC6), and src/lib/auth.ts fails loudly
// when this is unset. A fixed value keeps a failing run reproducible; it is a test
// secret and protects nothing.
process.env.JWT_SECRET ??= "c2c-integration-test-secret-not-for-production";
