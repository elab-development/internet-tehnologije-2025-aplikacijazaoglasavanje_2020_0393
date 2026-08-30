/**
 * Part 3 — release listings whose reservations have lapsed (spec §5.4).
 *
 * This is a convenience, not a correctness mechanism (D4). `POST /api/orders` expires and
 * releases whatever is holding the listing it is about to claim, inside its own
 * transaction, so the data is correct whether or not this ever runs. What it buys is
 * promptness: without it, a listing whose buyer went quiet stays out of browse until some
 * *other* buyer happens to try to order it, which is exactly the buyer who cannot see it.
 *
 * Run as `npm run db:expire-reservations`. A cron entry every ten minutes is ample for a
 * 48-hour deadline.
 */
import { fileURLToPath } from "node:url";

import { db } from "./index";
import { expireStalePendingOrders, releaseUnheldListings } from "./orders";

export type SweepResult = {
  expiredOrders: number;
  releasedListings: number;
};

/**
 * Expires every pending order past its deadline, then releases every listing nothing
 * pending is holding any more.
 *
 * The order matters and the transaction matters: releasing first would find the lapsed
 * orders still `pending` and leave their listings held until the next run. Both steps run
 * as one so a crash between them cannot leave an expired order beside a reserved listing.
 *
 * The cutoff is computed by Postgres, not Node — see `prune-tokens.ts` for why this
 * project does not trust the container clock.
 */
export async function expireReservations(): Promise<SweepResult> {
  return db.transaction(async (tx) => {
    const expiredOrders = await expireStalePendingOrders(tx);
    const releasedListings = await releaseUnheldListings(tx);
    return { expiredOrders, releasedListings };
  });
}

// Run only when invoked directly, so importing this module from a test does not sweep
// anything.
//
// `prune-tokens.ts` guards this with `import.meta.url.endsWith(argv[1].replace(/\\/g, "/"))`,
// but that comparison never matches on this project's own dev paths: both this worktree's
// and the primary checkout's directory names contain spaces ("IV godina", "Internet
// tehnologije"), which `import.meta.url` percent-encodes and `process.argv[1]` does not, so
// `endsWith` is always false. That is silence and exit 0 on every direct invocation — the
// exact "dead code" failure mode this guard exists to avoid. `fileURLToPath` decodes the URL
// back to a plain path before comparing, which matches regardless of spaces.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  expireReservations()
    .then(({ expiredOrders, releasedListings }) => {
      console.log(
        `Expired ${expiredOrders} reservation${expiredOrders === 1 ? "" : "s"}; ` +
          `returned ${releasedListings} listing${releasedListings === 1 ? "" : "s"} to browse.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed to expire reservations:", err);
      process.exit(1);
    });
}
