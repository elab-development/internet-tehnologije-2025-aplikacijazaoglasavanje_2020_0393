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

import { isDirectInvocation } from "./direct-invocation";
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
// anything. `isDirectInvocation` explains why that is not a string comparison.
if (isDirectInvocation(process.argv[1], import.meta.url)) {
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
