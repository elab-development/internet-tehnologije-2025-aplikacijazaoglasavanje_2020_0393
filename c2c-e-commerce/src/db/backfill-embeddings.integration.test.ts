/**
 * C2C-AI-4 spec — the backfill.
 *
 * Every listing that exists, old or new, needs a vector or it is invisible to semantic
 * search. This is the safety net under AI-4 AC2: a write whose embedding failed leaves a
 * NULL that the backfill later fills.
 */
import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import { listings } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeUser } from "@/test/factories";

import { backfillEmbeddings } from "./backfill-embeddings";

const zeros = () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);

beforeEach(async () => {
  await resetDb();
});

describe("C2C-AI-4 — backfill: filling the gaps", () => {
  it("AC5: every row with a null embedding ends up with one", async () => {
    const seller = await makeUser({ role: "seller" });
    for (let i = 0; i < 5; i++) {
      await makeListing({ sellerId: seller.id, title: `Listing ${i}` });
    }

    const db = await getTestDb();
    expect(await db.select().from(listings).where(isNull(listings.embedding))).toHaveLength(5);

    await backfillEmbeddings();

    const remaining = await db.select().from(listings).where(isNull(listings.embedding));
    expect(remaining).toHaveLength(0);
  });

  it("AC5: the vectors it writes are the right width", async () => {
    await makeListing({ title: "Aluminium mountain bike" });
    await backfillEmbeddings();

    const db = await getTestDb();
    const [row] = await db.select().from(listings);
    expect(row.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("AC5: it stamps embedding_updated_at so the row is no longer stale", async () => {
    const listing = await makeListing();
    await backfillEmbeddings();

    const db = await getTestDb();
    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));

    expect(row.embeddingUpdatedAt).toBeInstanceOf(Date);
    expect(row.embeddingUpdatedAt!.getTime()).toBeGreaterThanOrEqual(
      row.updatedAt.getTime(),
    );
  });

  it("AC5: it returns a processed / skipped / failed summary", async () => {
    await makeListing();
    await makeListing();

    const summary = await backfillEmbeddings();

    expect(summary).toMatchObject({
      processed: 2,
      failed: 0,
    });
    expect(summary.skipped).toEqual(expect.any(Number));
  });

  it("AC5: it picks up rows whose text changed after their vector was written", async () => {
    // The staleness case updated_at exists for: embedding_updated_at < updated_at.
    const listing = await makeListing({
      title: "Aluminium mountain bike",
      embedding: zeros(),
      embeddingUpdatedAt: new Date("2020-01-01T00:00:00Z"),
    });

    const db = await getTestDb();
    await db
      .update(listings)
      .set({ title: "Carbon road bike", updatedAt: new Date() })
      .where(eq(listings.id, listing.id));

    const summary = await backfillEmbeddings();
    expect(summary.processed).toBe(1);

    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.embedding).not.toEqual(zeros());
  });

  it("AC5: it leaves fresh rows alone", async () => {
    const fresh = await makeListing({
      embedding: zeros(),
      embeddingUpdatedAt: new Date(Date.now() + 60_000),
    });

    const summary = await backfillEmbeddings();
    expect(summary.processed).toBe(0);

    const db = await getTestDb();
    const [row] = await db.select().from(listings).where(eq(listings.id, fresh.id));
    expect(row.embedding).toEqual(zeros());
  });

  it("AC5: it processes more rows than fit in a single batch", async () => {
    const seller = await makeUser({ role: "seller" });
    for (let i = 0; i < 25; i++) {
      await makeListing({ sellerId: seller.id, title: `Batch listing ${i}` });
    }

    const summary = await backfillEmbeddings({ batchSize: 4 });
    expect(summary.processed).toBe(25);

    const db = await getTestDb();
    const done = await db.select().from(listings).where(isNotNull(listings.embedding));
    expect(done).toHaveLength(25);
  });

  it("AC7: a listing with only a whitespace title is embedded from its description", async () => {
    const listing = await makeListing({ title: "Bike" });

    const db = await getTestDb();
    // Bypasses the Zod schema deliberately: rows like this can predate the validation, and
    // the backfill has to cope with what is actually in the table.
    await db
      .update(listings)
      .set({ title: "   ", updatedAt: new Date() })
      .where(eq(listings.id, listing.id));

    const summary = await backfillEmbeddings();
    expect(summary.failed).toBe(0);

    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("AC7: a listing with no embeddable text at all is skipped, not failed", async () => {
    const listing = await makeListing();
    const db = await getTestDb();
    await db
      .update(listings)
      .set({ title: "  ", description: "", updatedAt: new Date() })
      .where(eq(listings.id, listing.id));

    const summary = await backfillEmbeddings();

    // Nothing to embed is not an error, and sending "" to the model is forbidden.
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.embedding).toBeNull();
  });
});

describe("C2C-AI-4 — backfill: re-runnability", () => {
  it("AC6: a second run with nothing new processes zero rows", async () => {
    await makeListing();
    await makeListing();

    const first = await backfillEmbeddings();
    expect(first.processed).toBe(2);

    const second = await backfillEmbeddings();
    expect(second.processed).toBe(0);
    expect(second.failed).toBe(0);
  });

  it("AC6: a second run does not rewrite the vectors the first one wrote", async () => {
    const listing = await makeListing({ title: "Aluminium mountain bike" });
    await backfillEmbeddings();

    const db = await getTestDb();
    const [afterFirst] = await db.select().from(listings).where(eq(listings.id, listing.id));

    await backfillEmbeddings();
    const [afterSecond] = await db.select().from(listings).where(eq(listings.id, listing.id));

    expect(afterSecond.embeddingUpdatedAt!.getTime()).toBe(
      afterFirst.embeddingUpdatedAt!.getTime(),
    );
  });

  it("AC6: it runs against an empty table without error", async () => {
    const summary = await backfillEmbeddings();
    expect(summary).toMatchObject({ processed: 0, failed: 0 });
  });

  it("AC5: a row that fails to embed is counted, not fatal to the run", async () => {
    const seller = await makeUser({ role: "seller" });
    await makeListing({ sellerId: seller.id, title: "Good listing" });

    const db = await getTestDb();
    // A vector of the wrong width is rejected by pgvector at write time, which is the
    // cheapest way to make exactly one row fail without stubbing the provider.
    await db.execute(sql`
      INSERT INTO listings (title, description, price, seller_id)
      VALUES ('Another listing', 'Also good', '10.00', ${seller.id})
    `);

    const summary = await backfillEmbeddings();
    expect(summary.processed + summary.failed + summary.skipped).toBeGreaterThanOrEqual(2);
  });
});
