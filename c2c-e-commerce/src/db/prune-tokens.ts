/**
 * C2C-SEC-2 — prune long-dead refresh tokens.
 *
 * Rows are kept for 30 days *after* they expire rather than deleted on expiry, because
 * reuse detection reads them: a token presented after its family was revoked should be
 * recognised as a replay, and a deleted row is indistinguishable from one that never
 * existed. Past 30 days nobody is plausibly still holding the token, and the row is only
 * cost.
 *
 * Run as `npm run db:prune-tokens`.
 */
import { lt, sql } from "drizzle-orm";

import { db } from "./index";
import { refreshTokens } from "./schema";

/** How long an expired token stays readable for audit and replay detection. */
export const PRUNE_AFTER_DAYS = 30;

/**
 * Deletes every token more than {@link PRUNE_AFTER_DAYS} past its expiry.
 *
 * The cutoff is computed by Postgres, not Node: the container clock and the host clock
 * disagree on this project's dev machines, and a boundary this coarse should not depend
 * on which one wins.
 *
 * @returns how many rows were deleted.
 */
export async function pruneRefreshTokens(): Promise<number> {
  const deleted = await db
    .delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, sql`now() - make_interval(days => ${PRUNE_AFTER_DAYS})`))
    .returning({ id: refreshTokens.id });

  return deleted.length;
}

// Run only when invoked directly, so importing this module from a test does not delete
// anything.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  pruneRefreshTokens()
    .then((count) => {
      console.log(
        `Pruned ${count} refresh token${count === 1 ? "" : "s"} more than ${PRUNE_AFTER_DAYS} days past expiry.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed to prune refresh tokens:", err);
      process.exit(1);
    });
}
