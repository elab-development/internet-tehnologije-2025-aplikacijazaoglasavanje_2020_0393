/**
 * C2C-AI-7 spec — the parts of search that are pure functions.
 *
 * Mode parsing and rank fusion decide the ranking, so they are tested here where a failure
 * points straight at the arithmetic rather than at a database round trip.
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  MIN_SIMILARITY,
  RRF_K,
  SEARCH_MODES,
  buildListingQuery,
  parseSearchMode,
  reciprocalRankFusion,
} from "./listings-query";

describe("C2C-AI-7 — parseSearchMode", () => {
  it("AC1: an absent mode defaults to keyword, leaving existing clients untouched", () => {
    expect(parseSearchMode(null)).toEqual({ ok: true, mode: "keyword" });
  });

  it("AC1: an empty mode defaults to keyword", () => {
    expect(parseSearchMode("")).toEqual({ ok: true, mode: "keyword" });
  });

  it("accepts each documented mode", () => {
    for (const mode of SEARCH_MODES) {
      expect(parseSearchMode(mode)).toEqual({ ok: true, mode });
    }
  });

  it("AC9: an unrecognised mode is rejected, naming the allowed values", () => {
    const result = parseSearchMode("fuzzy");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const mode of SEARCH_MODES) {
      expect(result.error).toContain(mode);
    }
  });

  it("AC9: the rejection names the offending value so the caller can see the typo", () => {
    const result = parseSearchMode("sematic");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("sematic");
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    expect(parseSearchMode("  semantic  ")).toEqual({ ok: true, mode: "semantic" });
  });

  it("is case-insensitive", () => {
    expect(parseSearchMode("SEMANTIC")).toEqual({ ok: true, mode: "semantic" });
  });

  it("exposes exactly the three documented modes", () => {
    expect([...SEARCH_MODES]).toEqual(["keyword", "semantic", "hybrid"]);
  });
});

describe("C2C-AI-7 — reciprocal rank fusion", () => {
  it("uses k = 60, the value the story specifies", () => {
    expect(RRF_K).toBe(60);
  });

  it("AC5: a document in both rankings outranks one in only a single ranking", () => {
    // The whole point of hybrid mode: matching the keyword *and* the meaning beats
    // matching either alone.
    const fused = reciprocalRankFusion([
      [1, 2],
      [1, 3],
    ]);

    expect(fused[0].id).toBe(1);
  });

  it("AC5: it beats a document that is first in one ranking but absent from the other", () => {
    const fused = reciprocalRankFusion([
      [2, 1],
      [3, 1],
    ]);

    // 1 is second in both: 2/(60+2) = 0.03226.
    // 2 is first in one only:   1/(60+1) = 0.01639.
    expect(fused[0].id).toBe(1);
  });

  it("scores by the sum of 1/(k + rank), with rank counted from 1", () => {
    const [first] = reciprocalRankFusion([[7]]);

    expect(first.id).toBe(7);
    expect(first.score).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it("sums a document's contribution from every ranking it appears in", () => {
    const fused = reciprocalRankFusion([[9], [9]]);
    expect(fused[0].score).toBeCloseTo(2 / (RRF_K + 1), 10);
  });

  it("returns documents in descending score order", () => {
    const fused = reciprocalRankFusion([
      [1, 2, 3],
      [3, 2, 1],
    ]);

    const scores = fused.map((entry) => entry.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("AC6: keeps a document that appears in only one ranking", () => {
    // A listing whose embedding is NULL can only reach the keyword arm. Dropping
    // single-arm documents would hide it entirely, which is exactly what AC6 forbids.
    const fused = reciprocalRankFusion([[1], [2]]);
    expect(fused.map((entry) => entry.id).sort()).toEqual([1, 2]);
  });

  it("returns every distinct document exactly once", () => {
    const fused = reciprocalRankFusion([
      [1, 2, 3],
      [2, 3, 4],
    ]);

    const ids = fused.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([1, 2, 3, 4]);
  });

  it("handles empty rankings without producing NaN scores", () => {
    expect(reciprocalRankFusion([[], []])).toEqual([]);
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], [5]])).toEqual([
      { id: 5, score: 1 / (RRF_K + 1) },
    ]);
  });

  it("breaks ties deterministically, so pagination cannot duplicate or drop a row", () => {
    // AC8 depends on this: two rows with equal scores must order the same way on every
    // call, or page 2 can repeat a row from page 1.
    const first = reciprocalRankFusion([[1, 2, 3]]);
    const second = reciprocalRankFusion([[1, 2, 3]]);
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
  });
});

describe("C2C-AI-7 — the similarity floor", () => {
  it("AC4: MIN_SIMILARITY is a positive threshold below 1", () => {
    // Without a floor, semantic mode always returns *something* — the least-bad row in the
    // table — and AC4's "a query unrelated to any listing returns nothing" is unachievable.
    expect(MIN_SIMILARITY).toBeGreaterThan(0);
    expect(MIN_SIMILARITY).toBeLessThan(1);
  });
});

describe("search wildcard escaping", () => {
  // A LIKE pattern treats % and _ as wildcards, so a search for "50%" matched every
  // listing in the marketplace.
  //
  // `JSON.stringify` on the raw `where` SQL object throws -- its query chunks carry
  // the `listings` table object, which closes a circular reference through its own
  // columns -- so this builds the actual query text through Drizzle's own dialect
  // (the same code path that runs against Postgres) and asserts on the bound
  // parameter, which is the one place the escaping can be observed directly.
  const dialect = new PgDialect();

  it("treats % as a literal", () => {
    const built = buildListingQuery(new URLSearchParams({ search: "50%" }), null);
    expect(built.ok).toBe(true);
    expect(built.ok && built.query.search).toBe("50%");

    if (!built.ok || !built.query.where) {
      throw new Error("expected a keyword search to produce a where clause");
    }
    const query = dialect.sqlToQuery(built.query.where);
    expect(query.params).toContain("%50\\%%");
  });

  it("treats _ as a literal", () => {
    const built = buildListingQuery(new URLSearchParams({ search: "a_b" }), null);

    if (!built.ok || !built.query.where) {
      throw new Error("expected a keyword search to produce a where clause");
    }
    const query = dialect.sqlToQuery(built.query.where);
    expect(query.params).toContain("%a\\_b%");
  });

  // The character class that escapes % and _ must also escape the escape character
  // itself -- otherwise a literal backslash in the search term would combine with
  // whatever follows it into an unintended escape sequence at the database.
  it("treats a literal backslash as itself", () => {
    const built = buildListingQuery(new URLSearchParams({ search: "a\\b" }), null);

    if (!built.ok || !built.query.where) {
      throw new Error("expected a keyword search to produce a where clause");
    }
    const query = dialect.sqlToQuery(built.query.where);
    expect(query.params).toContain("%a\\\\b%");
  });
});

describe("ordering is total", () => {
  const dialect = new PgDialect();

  // Without a tiebreaker, two listings sharing a createdAt (or a price, under
  // sort=price_asc) can swap places between two requests -- so a row falls into the gap
  // between page 1 and page 2, or is served on both.
  //
  // `orderBy` terms are Drizzle `SQL` objects that hold a back-reference to their table,
  // so `JSON.stringify` on the term itself throws ("Converting circular structure to
  // JSON"). `dialect.sqlToQuery` renders each term to its `{ sql, params }` shape first --
  // the same move the search-escaping tests above make for `where` -- which is plain data
  // and safe to stringify.
  it.each(["newest", "oldest", "price_asc", "price_desc"])(
    "breaks ties by id under sort=%s",
    (sort) => {
      const built = buildListingQuery(new URLSearchParams({ sort }), null);
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      // Two order terms, the second of which is the primary key.
      expect(built.query.orderBy).toHaveLength(2);
      const rendered = built.query.orderBy.map((term) => dialect.sqlToQuery(term).sql);
      expect(rendered[1]).toMatch(/"id"/);
    },
  );
});
