/**
 * C2C-AI-10 spec — GET /api/recommendations.
 *
 * Personalised from data the database already has: what the user ordered and what they
 * reviewed. Per decision D4 there is no `listing_views` table, and none is introduced.
 *
 * The `strategy` field is what makes the cold-start path observable here and honest in the
 * UI — without it, "personalised" and "popular" are indistinguishable from outside.
 */
import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { listings, orderItems, orders, reviews } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeReview, makeUser } from "@/test/factories";
import {
  loadSemanticCatalogue,
  type CatalogueEntry,
} from "@/test/fixtures/semantic-catalogue";

type Body = {
  data: { id: number; title: string; status: string; sellerId: number }[];
  strategy: "personalised" | "popular";
};

async function recommend(
  headers: Record<string, string> = {},
  query = "",
): Promise<{ status: number; body: Body }> {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/recommendations?${query}`, { headers }),
  );
  return { status: response.status, body: (await response.json()) as Body };
}

let catalogue: CatalogueEntry[];
const inCluster = (cluster: CatalogueEntry["cluster"]) =>
  catalogue.filter((entry) => entry.cluster === cluster);

beforeEach(async () => {
  await resetDb();
  catalogue = await loadSemanticCatalogue();
});

describe("C2C-AI-10 — AC5: authentication", () => {
  it("AC5: an anonymous caller is rejected with 401", async () => {
    const { status } = await recommend();
    expect(status).toBe(401);
  });
});

describe("C2C-AI-10 — AC1: a buyer with history", () => {
  it("AC1: gets up to ten active listings flagged personalised", async () => {
    const buyer = await makeUser({ role: "buyer" });
    await makeOrder({ buyerId: buyer.id, listingId: inCluster("cycling")[0].id });

    const { status, body } = await recommend(authHeaderFor(buyer));

    expect(status).toBe(200);
    expect(body.strategy).toBe("personalised");
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.length).toBeLessThanOrEqual(10);
  });

  it("AC1: every recommendation is active", async () => {
    const db = await getTestDb();
    const buyer = await makeUser({ role: "buyer" });
    await makeOrder({ buyerId: buyer.id, listingId: inCluster("cycling")[0].id });

    await db
      .update(listings)
      .set({ status: "sold" })
      .where(eq(listings.id, inCluster("cycling")[1].id));

    const { body } = await recommend(authHeaderFor(buyer));

    for (const row of body.data) {
      expect(row.status).toBe("active");
    }
    expect(body.data.map((r) => r.id)).not.toContain(inCluster("cycling")[1].id);
  });

  it("AC1: an explicit limit is honoured", async () => {
    const buyer = await makeUser({ role: "buyer" });
    await makeOrder({ buyerId: buyer.id, listingId: inCluster("cycling")[0].id });

    const { body } = await recommend(authHeaderFor(buyer), "limit=3");
    expect(body.data.length).toBe(3);
  });

  it("AC1: a review alone is enough history to personalise", async () => {
    const buyer = await makeUser({ role: "buyer" });
    await makeReview({
      reviewerId: buyer.id,
      listingId: inCluster("phones")[0].id,
      rating: 5,
    });

    const { body } = await recommend(authHeaderFor(buyer));
    expect(body.strategy).toBe("personalised");
  });
});

describe("C2C-AI-10 — AC7: the recommendations are actually relevant", () => {
  it("AC7: a buyer who ordered two bicycles gets a cycling listing in the top three", async () => {
    // The criterion that separates a recommender from a list of rows. It works because
    // QA-3's catalogue has real clusters rather than hashed noise.
    const buyer = await makeUser({ role: "buyer" });
    const bikes = inCluster("cycling");

    await makeOrder({ buyerId: buyer.id, listingId: bikes[0].id });
    await makeOrder({ buyerId: buyer.id, listingId: bikes[1].id });

    const { body } = await recommend(authHeaderFor(buyer));
    const cyclingIds = new Set(bikes.map((entry) => entry.id));

    expect(body.data.slice(0, 3).some((row) => cyclingIds.has(row.id))).toBe(true);
  });

  it("AC7: the whole top three follows the taste, not just one row", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const bikes = inCluster("cycling");

    await makeOrder({ buyerId: buyer.id, listingId: bikes[0].id });
    await makeOrder({ buyerId: buyer.id, listingId: bikes[1].id });

    const { body } = await recommend(authHeaderFor(buyer));
    const cyclingIds = new Set(bikes.map((entry) => entry.id));

    for (const row of body.data.slice(0, 3)) {
      expect(cyclingIds.has(row.id)).toBe(true);
    }
  });

  it("AC7: a different taste yields different recommendations", async () => {
    // A positive control on the whole story: if both buyers got the same list, nothing
    // above would prove the vector was consulted at all.
    const cyclist = await makeUser({ role: "buyer" });
    await makeOrder({ buyerId: cyclist.id, listingId: inCluster("cycling")[0].id });

    const furnisher = await makeUser({ role: "buyer" });
    await makeOrder({ buyerId: furnisher.id, listingId: inCluster("furniture")[0].id });

    const a = await recommend(authHeaderFor(cyclist));
    const b = await recommend(authHeaderFor(furnisher));

    expect(a.body.data.slice(0, 3).map((r) => r.id)).not.toEqual(
      b.body.data.slice(0, 3).map((r) => r.id),
    );
  });
});

describe("C2C-AI-10 — AC3/AC4: exclusions", () => {
  it("AC3: a listing the user already ordered never appears", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const bought = inCluster("cycling")[0];
    await makeOrder({ buyerId: buyer.id, listingId: bought.id });

    const { body } = await recommend(authHeaderFor(buyer), "limit=20");
    expect(body.data.map((r) => r.id)).not.toContain(bought.id);
  });

  it("AC3: every listing across several orders is excluded", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const bikes = inCluster("cycling");
    await makeOrder({ buyerId: buyer.id, listingId: bikes[0].id });
    await makeOrder({ buyerId: buyer.id, listingId: bikes[1].id });
    await makeOrder({ buyerId: buyer.id, listingId: bikes[2].id });

    const { body } = await recommend(authHeaderFor(buyer), "limit=20");
    const returned = body.data.map((r) => r.id);

    for (const bought of [bikes[0].id, bikes[1].id, bikes[2].id]) {
      expect(returned).not.toContain(bought);
    }
  });

  it("AC4: a seller is never recommended their own listings", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });

    // Give the seller a taste, and some inventory in that same taste.
    await makeOrder({ buyerId: seller.id, listingId: inCluster("cycling")[0].id });
    await db
      .update(listings)
      .set({ sellerId: seller.id })
      .where(inArray(listings.id, inCluster("cycling").slice(1, 4).map((e) => e.id)));

    const { body } = await recommend(authHeaderFor(seller), "limit=20");

    for (const row of body.data) {
      expect(row.sellerId).not.toBe(seller.id);
    }
  });

  it("AC3: a reviewed listing may still be recommended — only orders are excluded", async () => {
    // Reviewing is not owning. The story excludes what the user ordered, not what they
    // rated, and conflating them would quietly shrink the pool.
    const buyer = await makeUser({ role: "buyer" });
    const reviewed = inCluster("phones")[0];
    await makeReview({ reviewerId: buyer.id, listingId: reviewed.id, rating: 5 });

    const { body } = await recommend(authHeaderFor(buyer), "limit=20");
    expect(body.data.map((r) => r.id)).toContain(reviewed.id);
  });

  it("recommends a listing whose order was declined, because it is back in browse", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const wanted = inCluster("cycling")[0];
    await makeOrder({ buyerId: buyer.id, listingId: wanted.id, status: "completed" });
    const declined = inCluster("cycling")[1];
    await makeOrder({ buyerId: buyer.id, listingId: declined.id, status: "declined" });

    const { body } = await recommend(authHeaderFor(buyer), "limit=20");

    expect(body.data.map((r) => r.id)).toContain(declined.id);
    expect(body.data.map((r) => r.id)).not.toContain(wanted.id);
  });
});

describe("C2C-AI-10 — AC2/AC6: the cold start", () => {
  it("AC2: a brand-new buyer gets a non-empty popular list", async () => {
    const newcomer = await makeUser({ role: "buyer" });
    const { status, body } = await recommend(authHeaderFor(newcomer));

    expect(status).toBe(200);
    expect(body.strategy).toBe("popular");
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("AC2: the popular list is still active listings only", async () => {
    const db = await getTestDb();
    const newcomer = await makeUser({ role: "buyer" });

    await db
      .update(listings)
      .set({ status: "removed" })
      .where(eq(listings.id, catalogue[0].id));

    const { body } = await recommend(authHeaderFor(newcomer), "limit=20");

    for (const row of body.data) {
      expect(row.status).toBe("active");
    }
  });

  it("AC4: even the popular list excludes the caller's own listings", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });

    await db
      .update(listings)
      .set({ sellerId: seller.id })
      .where(inArray(listings.id, catalogue.slice(0, 5).map((e) => e.id)));

    const { body } = await recommend(authHeaderFor(seller), "limit=20");

    expect(body.strategy).toBe("popular");
    for (const row of body.data) {
      expect(row.sellerId).not.toBe(seller.id);
    }
  });

  it("AC6: history made entirely of unembedded listings falls back to popular", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const seller = await makeUser({ role: "seller" });
    const unembedded = await makeListing({ sellerId: seller.id, title: "No vector" });

    await makeOrder({ buyerId: buyer.id, listingId: unembedded.id });

    const { status, body } = await recommend(authHeaderFor(buyer));

    // Not an empty list and not a 500: an un-embeddable history is an ordinary state that
    // AI-4 AC2 produces whenever the embedder fails.
    expect(status).toBe(200);
    expect(body.strategy).toBe("popular");
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("AC2: an empty catalogue yields an empty list rather than an error", async () => {
    const db = await getTestDb();
    const newcomer = await makeUser({ role: "buyer" });
    await db.update(listings).set({ status: "removed" });

    const { status, body } = await recommend(authHeaderFor(newcomer));

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.strategy).toBe("popular");
  });
});

describe("C2C-AI-10 — the limit is bounded", () => {
  it("caps an absurd limit rather than returning the table", async () => {
    const newcomer = await makeUser({ role: "buyer" });
    const { body } = await recommend(authHeaderFor(newcomer), "limit=999");

    expect(body.data.length).toBeLessThanOrEqual(50);
  });

  it("falls back to the default for a non-positive or unparseable limit", async () => {
    const newcomer = await makeUser({ role: "buyer" });

    for (const limit of ["0", "-3", "many"]) {
      const { body } = await recommend(authHeaderFor(newcomer), `limit=${limit}`);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.length).toBeLessThanOrEqual(10);
    }
  });
});

describe("C2C-AI-10 — AC9: latency", () => {
  it("AC9: fifty interactions still answer well inside 500 ms", async () => {
    const buyer = await makeUser({ role: "buyer" });

    // Fifty separate orders, which is the shape the cap in buildTasteVector exists for.
    for (let i = 0; i < 50; i++) {
      await makeOrder({
        buyerId: buyer.id,
        listingId: catalogue[i % catalogue.length].id,
      });
    }

    const started = performance.now();
    const { status, body } = await recommend(authHeaderFor(buyer));
    const elapsed = performance.now() - started;

    expect(status).toBe(200);
    expect(body.strategy).toBe("personalised");
    expect(elapsed).toBeLessThan(500);
  }, 120_000);
});

describe("C2C-AI-10 — the embedding never leaves the server", () => {
  it("recommendations omit the embedding columns", async () => {
    const buyer = await makeUser({ role: "buyer" });
    await makeOrder({ buyerId: buyer.id, listingId: inCluster("cycling")[0].id });

    const { body } = await recommend(authHeaderFor(buyer));

    expect(body.strategy).toBe("personalised");
    expect(body.data[0]).not.toHaveProperty("embedding");
    expect(body.data[0]).not.toHaveProperty("embeddingUpdatedAt");
  });
});

describe("C2C-AI-10 — the interaction cap is about recency", () => {
  /**
   * The cap exists so taste stays responsive: 50 interactions, the most recent ones. That
   * only holds if the two arms are merged into one timeline before it is applied. Fetching
   * 50 orders and 50 reviews and concatenating them gives 100 rows, and any cap over that
   * concatenation cuts on arm boundaries rather than on dates.
   */
  it("builds taste from the newest interactions, not the ones the cap should drop", async () => {
    const db = await getTestDb();
    const buyer = await makeUser({ role: "buyer" });

    const cycling = inCluster("cycling")[0];
    const furniture = inCluster("furniture")[0];

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Read rather than assumed: the catalogue's seller is created inside the fixture, so
    // the id is not one this test can spell out.
    const [{ sellerId: cyclingSellerId }] = await db
      .select({ sellerId: listings.sellerId })
      .from(listings)
      .where(eq(listings.id, cycling.id))
      .limit(1);

    // 50 orders of a bicycle, all from the last fortnight.
    for (let i = 0; i < 50; i++) {
      const [order] = await db
        .insert(orders)
        .values({
          buyerId: buyer.id,
          sellerId: cyclingSellerId,
          listingId: cycling.id,
          price: "10.00",
          totalPrice: "10.00",
          status: "completed",
          expiresAt: new Date(now - i * day * 0.25 + 48 * 60 * 60 * 1000),
          createdAt: new Date(now - i * day * 0.25),
        })
        .returning();
      await db.insert(orderItems).values({
        orderId: order.id,
        listingId: cycling.id,
        price: "10.00",
        quantity: 1,
      });
    }

    // 50 reviews of a sofa, all from more than a year ago.
    await db.insert(reviews).values(
      Array.from({ length: 50 }, (_, i) => ({
        reviewerId: buyer.id,
        listingId: furniture.id,
        rating: 5,
        comment: "Solid.",
        createdAt: new Date(now - (400 + i) * day),
      })),
    );

    const { body } = await recommend(authHeaderFor(buyer));
    const clusterById = new Map(catalogue.map((entry) => [entry.id, entry.cluster]));

    expect(body.strategy).toBe("personalised");
    // Under a concatenated cap the whole order arm falls off the end and the top result is
    // the year-old sofa itself, which is an exact vector match.
    expect(clusterById.get(body.data[0].id)).toBe("cycling");
  });
});
