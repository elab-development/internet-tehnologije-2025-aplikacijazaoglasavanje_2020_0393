/**
 * Whether this module is the script Node was asked to run.
 *
 * Both maintenance scripts in this directory guard their side effects with this, so that
 * importing them from a test does not prune tokens or expire reservations. That makes the
 * predicate load-bearing in a quiet way: when it wrongly returns false the script prints
 * nothing and exits 0, which is indistinguishable from having run and found no work.
 *
 * `prune-tokens.ts` had it wrong for exactly that reason. It asked whether
 * `import.meta.url` *ended with* `process.argv[1]` slash-normalised — but the first is a
 * URL and percent-encodes anything a path may legally contain, while the second does not.
 * A single space breaks it, and this project's own directories hold two ("IV godina",
 * "Internet tehnologije"), so `npm run db:prune-tokens` had been silently doing nothing.
 *
 * Decoding the URL back into a path removes the whole class: `fileURLToPath` undoes the
 * encoding, and the comparison is then between two plain paths.
 */
import { fileURLToPath } from "node:url";

export function isDirectInvocation(
  argv1: string | undefined,
  metaUrl: string,
): boolean {
  if (!argv1) return false;
  return argv1 === fileURLToPath(metaUrl);
}
