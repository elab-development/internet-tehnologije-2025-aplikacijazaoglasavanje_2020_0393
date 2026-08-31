/**
 * The re-parenting guards used to read on the module client before the transaction
 * opened, so two simultaneous moves each validated against paths the other was about to
 * invalidate. A cycle in a materialised-path tree is not a cosmetic problem: descendant
 * queries stop terminating, and there is no constraint that would have caught it.
 *
 * The regression test below does not rely on `Promise.allSettled` and hoping the two
 * requests interleave. For two direct siblings swapping places under each other, the
 * resulting paths are always the same length, so a plain `path.startsWith` check on the
 * final rows can never observe both directions at once -- mutual string prefixing forces
 * equality, which two distinct nodes never have, so that check could not fail on buggy
 * code either. The real invariant a two-node swap can violate is `parentId` reciprocity
 * (`a.parentId === b.id && b.parentId === a.id`), which is what this test asserts on.
 *
 * Determinism comes from the same technique src/db/orders.integration.test.ts and
 * src/app/api/listings/[id]/delete-with-orders.integration.test.ts already use: a second
 * connection's transaction is held open across a manually performed "A moves under B",
 * provably still uncommitted, before the real handler is invoked to move B under A. Both
 * moves lock the same pair of rows in the same order, so the handler's own lock has to
 * wait for that transaction to commit -- whether it then discovers the cycle is not a
 * matter of luck.
 *
 * Written against PUT, matching the handler as it exists now; Task 18 renames it to PATCH.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { findCategoryById } from "@/db/categories";
import { signToken } from "@/lib/auth";
import { resetDb, testPool } from "@/test/db";
import { makeCategory, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

function moveRequest(token: string, parentId: number | null): NextRequest {
  return new NextRequest("http://localhost/api/categories/0", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ parentId }),
  });
}

async function move(id: number, parentId: number | null, adminToken: string) {
  const { PUT } = await import("./[id]/route");
  return PUT(moveRequest(adminToken, parentId), {
    params: Promise.resolve({ id: String(id) }),
  });
}

/** A and B are root siblings, each individually free to move under the other. */
async function seedTwoRootCategories() {
  const admin = await makeUser({ role: "admin" });
  const adminToken = signToken({ sub: admin.id, email: admin.email, role: admin.role });
  const a = await makeCategory({ slug: "root-a" });
  const b = await makeCategory({ slug: "root-b" });
  return { a, b, adminToken };
}

describe("concurrent category moves", () => {
  it("cannot produce a cycle when a concurrent move commits mid-transaction", async () => {
    const { a, b, adminToken } = await seedTwoRootCategories();

    // A dedicated pool: the shared one backs resetDb() and the factories, and holding a
    // connection open across a lock wait would starve them.
    const pool = await testPool();
    const client = await pool.connect();

    try {
      // Connection A plays "A moves under B" directly against the rows, so it can be held
      // open under FOR UPDATE exactly as a real concurrent move would hold it, then
      // released deterministically instead of by chance timing. It locks the same pair of
      // rows, lowest id first, that the fixed handler locks -- so the real move below is
      // guaranteed to queue behind it rather than race it.
      const lockIds = [a.id, b.id].sort((x, y) => x - y);
      await client.query("BEGIN");
      await client.query('SELECT id FROM categories WHERE id = ANY($1) FOR UPDATE', [lockIds]);
      await client.query(
        'UPDATE categories SET parent_id = $1, path = $2, depth = 1 WHERE id = $3',
        [b.id, `${b.id}.${a.id}`, a.id],
      );

      // Deliberately not awaited yet: the handler's own row lock has to reach the server
      // and block on connection A's still-open lock, which is the interleaving under
      // test.
      const movePromise = move(b.id, a.id, adminToken);
      await new Promise((resolve) => setTimeout(resolve, 250));

      await client.query("COMMIT");
      const response = await movePromise;

      // By the time this transaction's lock was granted, A had already landed under B.
      // Re-parenting B under A now would close the loop, and the fixed handler has to see
      // that against the fresh row it re-reads under lock -- not the stale sibling
      // relationship that stood before either move started.
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "A category cannot be moved under its own descendant",
      });

      const rowA = await findCategoryById(a.id);
      const rowB = await findCategoryById(b.id);
      const cyclic = rowA?.parentId === b.id && rowB?.parentId === a.id;
      expect(cyclic).toBe(false);

      // A's manually-applied move still stands; B's was correctly refused.
      expect(rowA?.parentId).toBe(b.id);
      expect(rowB?.parentId).toBeNull();
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("still performs a single legal move", async () => {
    // Positive control: a handler that refused every move would pass the assertions
    // above just as well as a correct one.
    const { a, b, adminToken } = await seedTwoRootCategories();

    const response = await move(a.id, b.id, adminToken);

    expect(response.status).toBe(200);
    const rowA = await findCategoryById(a.id);
    expect(rowA?.parentId).toBe(b.id);
  });
});
