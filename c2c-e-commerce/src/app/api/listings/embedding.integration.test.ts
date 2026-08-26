/**
 * C2C-AI-4 spec — the write path, through the real route handlers.
 *
 * The embedding provider is wrapped rather than replaced: the real mock provider does the
 * work, and the wrapper counts calls and can be told to throw. AC4 needs the call count
 * ("no embed call is made") and AC2 needs the failure, so both come from one seam.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import { listings } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeCategory, makeListing, makeUser } from "@/test/factories";

const control = vi.hoisted(() => ({ shouldThrow: false, embedCalls: 0 }));

vi.mock("@/lib/ai/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/embeddings")>();

  return {
    ...actual,
    getEmbeddingProvider: () => {
      const real = actual.getEmbeddingProvider();
      return {
        model: real.model,
        warmup: () => real.warmup(),
        embed: async (text: string) => {
          control.embedCalls += 1;
          if (control.shouldThrow) throw new Error("embedding backend is down");
          return real.embed(text);
        },
        embedBatch: async (texts: string[]) => {
          control.embedCalls += 1;
          if (control.shouldThrow) throw new Error("embedding backend is down");
          return real.embedBatch(texts);
        },
      };
    },
  };
});

async function post(body: unknown, headers: Record<string, string>) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/listings", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function put(id: number, body: unknown, headers: Record<string, string>) {
  const { PUT } = await import("./[id]/route");
  return PUT(
    new NextRequest(`http://localhost/api/listings/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

async function rowById(id: number) {
  const db = await getTestDb();
  const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  return row;
}

beforeEach(async () => {
  await resetDb();
  control.shouldThrow = false;
  control.embedCalls = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("C2C-AI-4 — POST /api/listings", () => {
  it("AC1: a valid create stores a 384-dimension embedding and stamps embedding_updated_at", async () => {
    const seller = await makeUser({ role: "seller" });
    const category = await makeCategory();

    const response = await post(
      {
        title: "Aluminium mountain bike",
        description: "Hardtail frame, recently serviced.",
        price: 220,
        categoryId: category.id,
      },
      authHeaderFor(seller),
    );

    expect(response.status).toBe(201);

    const created = await response.json();
    const row = await rowById(created.id);

    expect(row.embedding).not.toBeNull();
    expect(row.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(row.embeddingUpdatedAt).toBeInstanceOf(Date);
  });

  it("AC1: the stored vector is the one built from the title and description", async () => {
    const seller = await makeUser({ role: "seller" });
    const actual = await import("@/lib/ai/embeddings");

    const response = await post(
      { title: "Aluminium mountain bike", description: "Hardtail frame.", price: 220 },
      authHeaderFor(seller),
    );
    const created = await response.json();
    const row = await rowById(created.id);

    const expected = await actual
      .getEmbeddingProvider()
      .embed("Aluminium mountain bike\n\nHardtail frame.");

    // Not merely "a vector" — the vector for this listing's text. A write path that
    // embedded the title alone would still satisfy AC1's shape check.
    expect(row.embedding?.[0]).toBeCloseTo(expected[0], 5);
    expect(row.embedding?.[383]).toBeCloseTo(expected[383], 5);
  });

  it("AC2: an embedding failure still returns 201 and stores the listing", async () => {
    const seller = await makeUser({ role: "seller" });

    // Positive control: without the failure this same request embeds. Without it, the
    // assertions below would pass just as well against a route that never embeds at all.
    const ok = await post(
      { title: "Control listing", description: "Embeds fine.", price: 10 },
      authHeaderFor(seller),
    );
    expect((await rowById((await ok.json()).id)).embedding).not.toBeNull();

    control.shouldThrow = true;

    const response = await post(
      { title: "Aluminium mountain bike", description: "Hardtail frame.", price: 220 },
      authHeaderFor(seller),
    );

    // A seller losing their listing because the embedder threw is far worse than a
    // listing that is temporarily unsearchable by meaning — it is still fully
    // keyword-searchable.
    expect(response.status).toBe(201);

    const created = await response.json();
    const row = await rowById(created.id);
    expect(row).toBeDefined();
    expect(row.embedding).toBeNull();
    expect(row.embeddingUpdatedAt).toBeNull();
  });

  it("AC2: the failure is logged once, and the log line carries the listing id", async () => {
    const seller = await makeUser({ role: "seller" });
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    control.shouldThrow = true;

    const response = await post(
      { title: "Aluminium mountain bike", description: "Hardtail frame.", price: 220 },
      authHeaderFor(seller),
    );
    const created = await response.json();

    const relevant = errors.filter((line) => line.includes(String(created.id)));
    expect(relevant).toHaveLength(1);
  });

  it("AC2: a failed embedding leaves a row the backfill will pick up", async () => {
    const seller = await makeUser({ role: "seller" });

    control.embedCalls = 0;
    control.shouldThrow = true;

    const response = await post(
      { title: "Aluminium mountain bike", description: "Hardtail frame.", price: 220 },
      authHeaderFor(seller),
    );
    const created = await response.json();
    const row = await rowById(created.id);

    expect(row.embedding).toBeNull();
    expect(row.updatedAt).toBeInstanceOf(Date);
    // The route must have *tried*; a row left NULL because nothing ever embeds is not
    // what this criterion is about.
    expect(control.embedCalls).toBeGreaterThan(0);
  });
});

describe("C2C-AI-4 — PUT /api/listings/[id]", () => {
  it("AC3: changing the title recomputes the embedding and advances embedding_updated_at", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({
      sellerId: seller.id,
      title: "Aluminium mountain bike",
      description: "Hardtail frame.",
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
      embeddingUpdatedAt: new Date("2020-01-01T00:00:00Z"),
    });

    const response = await put(listing.id, { title: "Carbon road bike" }, authHeaderFor(seller));
    expect(response.status).toBe(200);

    const row = await rowById(listing.id);
    expect(row.embeddingUpdatedAt!.getTime()).toBeGreaterThan(
      listing.embeddingUpdatedAt!.getTime(),
    );
    expect(row.embedding).not.toEqual(listing.embedding);
  });

  it("AC3: changing the description also recomputes it", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, title: "Bike" });

    control.embedCalls = 0;
    await put(listing.id, { description: "Now with new tyres." }, authHeaderFor(seller));

    expect(control.embedCalls).toBeGreaterThan(0);
    expect((await rowById(listing.id)).embedding).not.toBeNull();
  });

  it("AC4: changing only the price makes no embed call and leaves the vector alone", async () => {
    const seller = await makeUser({ role: "seller" });
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
      i === 0 ? 1 : 0,
    );
    const stamped = new Date("2020-01-01T00:00:00Z");
    const listing = await makeListing({
      sellerId: seller.id,
      embedding,
      embeddingUpdatedAt: stamped,
    });

    // Positive control: a title change on this same listing does embed. Without it,
    // "no embed call" would hold trivially against a route that never embeds.
    control.embedCalls = 0;
    await put(listing.id, { title: "Some other bike" }, authHeaderFor(seller));
    expect(control.embedCalls).toBeGreaterThan(0);

    control.embedCalls = 0;
    const response = await put(listing.id, { price: 150 }, authHeaderFor(seller));
    expect(response.status).toBe(200);

    expect(control.embedCalls).toBe(0);
    const row = await rowById(listing.id);
    expect(row.embeddingUpdatedAt!.getTime()).toBe(stamped.getTime());
    expect(row.embedding?.[0]).toBeCloseTo(1, 5);
  });

  it("AC4: changing status, imageUrl or categoryId makes no embed call", async () => {
    const seller = await makeUser({ role: "seller" });
    const category = await makeCategory();
    const listing = await makeListing({ sellerId: seller.id });

    control.embedCalls = 0;
    await put(listing.id, { description: "Rewritten." }, authHeaderFor(seller));
    expect(control.embedCalls).toBeGreaterThan(0);

    control.embedCalls = 0;
    await put(
      listing.id,
      { status: "sold", imageUrl: "https://images.unsplash.com/a.jpg", categoryId: category.id },
      authHeaderFor(seller),
    );

    expect(control.embedCalls).toBe(0);
  });

  it("AC4: resubmitting the identical title makes no embed call", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, title: "Aluminium mountain bike" });

    control.embedCalls = 0;
    await put(listing.id, { title: "A different title" }, authHeaderFor(seller));
    expect(control.embedCalls).toBeGreaterThan(0);

    control.embedCalls = 0;
    await put(
      listing.id,
      { title: "A different title", price: 150 },
      authHeaderFor(seller),
    );

    expect(control.embedCalls).toBe(0);
  });

  it("AC3: updated_at advances on every update, embedding_updated_at only on a re-embed", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({
      sellerId: seller.id,
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
      embeddingUpdatedAt: new Date("2020-01-01T00:00:00Z"),
    });

    await put(listing.id, { price: 150 }, authHeaderFor(seller));
    const row = await rowById(listing.id);

    // This is exactly the staleness signal the backfill queries on:
    // embedding_updated_at < updated_at means "the text moved on without the vector".
    expect(row.updatedAt.getTime()).toBeGreaterThan(listing.updatedAt.getTime());
    expect(row.embeddingUpdatedAt!.getTime()).toBe(
      listing.embeddingUpdatedAt!.getTime(),
    );
  });

  it("AC2: an embedding failure during update still returns 200", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    control.embedCalls = 0;
    control.shouldThrow = true;

    const response = await put(listing.id, { title: "Carbon road bike" }, authHeaderFor(seller));

    expect(control.embedCalls).toBeGreaterThan(0);
    expect(response.status).toBe(200);
    const row = await rowById(listing.id);
    expect(row.title).toBe("Carbon road bike");
    expect(row.embedding).toBeNull();
  });
});
