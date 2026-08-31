// ─── Reading Postgres errors through Drizzle ──────────────────────────────────
//
// A unique index is the last line of defence behind an application's own guards, and
// reaching it means a real conflict — a 409, not the 500 an unmapped constraint violation
// becomes. Recognising one takes two field reads, and getting those two field reads wrong
// is silent: the branch never matches, every happy-path test still passes, and the 500
// survives.
//
// One file, two callers (`src/db/orders.ts` and `src/db/reviews.ts`), because the thing
// worth stating once is *where* the fields are.

/** Postgres's SQLSTATE for `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Whether this error is the named unique index refusing a duplicate.
 *
 * Drizzle wraps the driver's error in a `DrizzleQueryError` rather than throwing it
 * directly, so `code` and `constraint` live on `.cause`, not on the error the caller
 * catches. Checking the error itself first keeps this correct if that ever stops being
 * true; falling back to one level of `.cause` is what makes it correct today.
 *
 * The index name is required rather than optional. Two unique indexes on one table would
 * otherwise collapse into one branch answering with one message, which is a worse failure
 * than the 500 this replaces.
 */
export function isUniqueViolation(err: unknown, indexName: string): boolean {
  return matches(err, indexName) || matches(cause(err), indexName);
}

function matches(err: unknown, indexName: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { code?: unknown; constraint?: unknown };
  return candidate.code === UNIQUE_VIOLATION && candidate.constraint === indexName;
}

function cause(err: unknown): unknown {
  if (typeof err !== "object" || err === null) return undefined;
  return (err as { cause?: unknown }).cause;
}
