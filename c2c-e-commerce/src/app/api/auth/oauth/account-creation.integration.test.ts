/**
 * The two writes used to be uncoordinated. A failure on the second left a passwordless
 * `users` row with no provider link: the next callback matched the email, returned
 * `needs_link`, and asked for a password that is null. The account was unreachable by
 * every route -- password login, OAuth, and linking alike.
 */
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { oauthAccounts, users } from "@/db/schema";
import { resetDb } from "@/test/db";

import { findOrCreateOAuthUser } from "./[provider]/callback/route";

const PROFILE = {
  email: "new-person@example.test",
  name: "New Person",
  providerAccountId: "google-123",
  emailVerified: true,
  avatarUrl: null,
};

beforeEach(async () => {
  await resetDb();
});

describe("OAuth account creation", () => {
  it("leaves no user row behind when the provider link cannot be written", async () => {
    // Mocking `db.insert` cannot reach this branch: `db.transaction`'s callback gets its
    // own `NodePgTransaction`, a distinct object on a dedicated pooled connection, so a
    // call made through `tx.insert` never touches `db`'s `insert` property at all -- a
    // spy on `db` is invisible to it. And the ordinary way to force a *real* failure on
    // this table, a duplicate `(provider, provider_account_id)`, cannot reach the insert
    // either: `findOrCreateOAuthUser`'s own lookup already returns the existing link
    // before ever attempting to write it again. A constraint that rejects every new row
    // stands in for the dropped connection or replica failover that could genuinely fail
    // this write, on the real transaction the fix hands `tx`, not `db`.
    await db.execute(
      sql`alter table oauth_accounts add constraint deliberate_test_failure check (false)`,
    );

    try {
      // The injected failure by name, not merely "something threw". A regression that
      // made this throw *before* the first write -- a bad argument, a missing import --
      // would satisfy a bare `rejects.toThrow()` and both row counts below at once, and
      // the test would pass while proving nothing about the rollback it exists for.
      const failure = await findOrCreateOAuthUser("google", PROFILE).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure, "the link insert was expected to fail").not.toBeNull();
      // Drizzle reports the statement and wraps the driver's error, which is the half
      // carrying the constraint name -- so both halves of the chain are asserted: the
      // write that failed, and why.
      expect(causeChain(failure)).toMatch(/insert into "oauth_accounts"/);
      expect(causeChain(failure)).toMatch(/deliberate_test_failure/);

      // Neither row may survive. A user with no link is the unreachable-account state.
      expect(await db.select().from(users)).toHaveLength(0);
      expect(await db.select().from(oauthAccounts)).toHaveLength(0);
    } finally {
      await db.execute(sql`alter table oauth_accounts drop constraint deliberate_test_failure`);
    }
  });

  it("writes both rows on the happy path", async () => {
    const result = await findOrCreateOAuthUser("google", PROFILE);

    expect(result.outcome).toBe("ok");
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(oauthAccounts)).toHaveLength(1);
  });
});

/** An error and everything it wraps, flattened so a nested driver message is searchable. */
function causeChain(error: unknown): string {
  const messages: string[] = [];

  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }

  return messages.join(" | ");
}
