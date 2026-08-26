/**
 * Setup file for the `integration` Vitest project — runs once per test file, before any
 * test in it.
 *
 * C2C-QA-2 establishes only the contract: this file runs first, and it advertises that by
 * setting `C2C_TEST_DB_SETUP`. C2C-QA-3 replaces the body with the real harness — start a
 * `pgvector/pgvector:pg16` container (or use `TEST_DATABASE_URL` in CI), apply migrations,
 * and register the global teardown — while keeping the flag, which is what the QA-2 canary
 * asserts.
 */
process.env.C2C_TEST_DB_SETUP = "ready";
