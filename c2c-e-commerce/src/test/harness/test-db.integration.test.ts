/**
 * C2C-QA-3 spec — the live test database: migrations, isolation and one container per run.
 */
import { execFileSync } from "node:child_process";

import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, inject, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import { categories, listings, users } from "@/db/schema";

import { getTestDb, getTestDatabaseUrl, resetDb } from "../db";

beforeEach(async () => {
  await resetDb();
});

describe("C2C-QA-3 — migrations on the test database", () => {
  it("AC3: the vector extension is present", async () => {
    const db = await getTestDb();
    const result = await db.execute(
      sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it("AC3: listings.embedding exists with AI-3's width", async () => {
    const db = await getTestDb();
    const result = await db.execute(sql`
      SELECT format_type(a.atttypid, a.atttypmod) AS declared
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relname = 'listings' AND a.attname = 'embedding'
    `);
    expect(result.rows[0]).toMatchObject({
      declared: `vector(${EMBEDDING_DIMENSIONS})`,
    });
  });

  it("AC3: every table the factories write to exists", async () => {
    const db = await getTestDb();
    const result = await db.execute(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    const tables = result.rows.map((row) => row.tablename);

    for (const table of [
      "users",
      "categories",
      "listings",
      "orders",
      "order_items",
      "reviews",
    ]) {
      expect(tables).toContain(table);
    }
  });
});

describe("C2C-QA-3 — isolation between tests", () => {
  // These two run in order and are deliberately coupled: the first dirties the database
  // so the second can prove it was cleaned. Splitting them would prove nothing.
  it("AC4: writes rows", async () => {
    const db = await getTestDb();

    await db.insert(users).values({
      email: "isolation@example.com",
      passwordHash: "x",
      name: "Isolation",
    });
    // path is NOT NULL with no default; a direct insert (rather than the makeCategory
    // factory) has to supply one. Any root path — the row's own id — satisfies it here,
    // since this test only cares that the row exists.
    await db.insert(categories).values({ name: "Bikes", slug: "bikes", path: "1" });

    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("AC4: the next test sees an empty database with sequences restarted from 1", async () => {
    const db = await getTestDb();

    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(categories)).toHaveLength(0);
    expect(await db.select().from(listings)).toHaveLength(0);

    // RESTART IDENTITY, not merely DELETE: a test that asserts on a specific id would
    // otherwise pass alone and fail in suite order.
    const [user] = await db
      .insert(users)
      .values({ email: "first@example.com", passwordHash: "x", name: "First" })
      .returning();
    expect(user.id).toBe(1);
  });

  it("AC4: resetDb clears children before parents rather than failing on a foreign key", async () => {
    const db = await getTestDb();

    const [seller] = await db
      .insert(users)
      .values({ email: "seller@example.com", passwordHash: "x", name: "Seller" })
      .returning();
    const [category] = await db
      .insert(categories)
      .values({ name: "Bikes", slug: "bikes", path: "1" })
      .returning();
    await db.insert(listings).values({
      title: "A bike",
      description: "Rides well",
      price: "100.00",
      sellerId: seller.id,
      categoryId: category.id,
    });

    // CASCADE is what makes this work; without it, truncating users would error on the
    // listings reference.
    await expect(resetDb()).resolves.toBeUndefined();
    expect(await db.select().from(listings)).toHaveLength(0);
  });
});

describe("C2C-QA-3 — one container for the whole run", () => {
  it("AC8: this file talks to the database global setup started, not one of its own", async () => {
    // If a file started its own container, the URL — and therefore the port — would differ
    // from the one global setup published.
    expect(await getTestDatabaseUrl()).toBe(inject("testDatabaseUrl"));
  });

  it("AC8: the server this file sees started at the moment global setup recorded", async () => {
    const db = await getTestDb();
    const result = await db.execute(sql`SELECT pg_postmaster_start_time() AS started`);

    // A second container would be a second postmaster, with its own start time.
    expect(new Date(result.rows[0].started as string).toISOString()).toBe(
      inject("postmasterStartTime"),
    );
  });

  it("AC8: exactly one Testcontainers-managed database is running", () => {
    if (process.env.TEST_DATABASE_URL) return; // AC2: nothing was started to count.

    const ids = execFileSync(
      "docker",
      [
        "ps",
        "-q",
        "--filter",
        "label=org.testcontainers=true",
        "--filter",
        `ancestor=pgvector/pgvector:pg16`,
      ],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);

    expect(ids).toHaveLength(1);
  });
});
