/**
 * C2C-QA-3 AC9 — the crash half, as a standalone process.
 *
 * Starts a test-database container through the real harness and then kills itself with
 * SIGKILL, so no teardown hook, `finally` block or exit handler can run. What stops the
 * container afterwards is Testcontainers' reaper, and that is exactly the guarantee AC9
 * asks for: "the suite finishes **or crashes**".
 *
 * Not a test file: the name matches no project's glob, so normal runs ignore it.
 * `container-lifecycle.test.ts` spawns it and counts containers before and after.
 *
 *   npx tsx src/test/harness/ac9-crash-probe.ts
 */
import { getTestDatabaseUrl } from "../db";

// An async IIFE rather than top-level await: the package has no "type": "module", so this
// is a CommonJS module, which is also what lets it import the harness by name.
void (async () => {
  const url = await getTestDatabaseUrl();
  console.log(`probe started a database at ${url}`);

  // SIGKILL, not process.exit(): an orderly exit would let cleanup run and prove nothing.
  process.kill(process.pid, "SIGKILL");
})();
