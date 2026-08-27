/**
 * C2C-AI-7 — building the listings query.
 *
 * Extracted from the route handler, which was already long enough before three search
 * modes were added to it.
 *
 * Search is **additive** (decision D8): `mode` defaults to `keyword`, so every existing
 * client sees exactly what it saw before, and the thesis can compare keyword against
 * semantic on the same endpoint.
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import type { TokenPayload } from "@/lib/auth";
import { getEmbeddingProvider } from "@/lib/ai/embeddings";
import { resolveListingVisibility } from "@/lib/listing-visibility";

/** Additive by decision D8: `keyword` is the default, so existing clients are unaffected. */
export const SEARCH_MODES = ["keyword", "semantic", "hybrid"] as const;

export type SearchMode = (typeof SEARCH_MODES)[number];

/** Reciprocal-rank-fusion constant, fixed at 60 by the story. */
export const RRF_K = 60;

/**
 * Cosine similarity below which a semantic match is not worth returning.
 *
 * Calibrated against AI-2's measurement on the real model: a genuinely close pair scored
 * 0.53, unrelated pairs 0.16 and 0.09. A floor at 0.25 sits between them. A constant
 * rather than an environment variable, because a threshold that varies per deployment
 * makes the thesis's evaluation numbers unreproducible.
 */
export const MIN_SIMILARITY = 0.25;

/**
 * How many rows each arm contributes to fusion.
 *
 * Fusion has to happen before pagination, so each arm fetches a bounded candidate set and
 * the *fused* list is sliced for the page. The consequence is that results past this many
 * candidates are unreachable by paging — the right trade for a marketplace where the top
 * few dozen matter, and better than an unbounded fetch on every search.
 */
const FUSION_CANDIDATES = 200;

/**
 * The listing columns a client is allowed to see.
 *
 * `db.select()` and `.returning()` take *every* column, and `listings` now carries a
 * 384-float `embedding` — ~4.7 KB per row, eighteen times the rest of the row put together.
 * Sending it would be meaningless to a client, and it would break AI-7 AC1, which requires
 * this endpoint to answer exactly what it answered before the epic added the column.
 *
 * One definition rather than a list per route, so a column added later cannot reach some
 * responses and not others.
 */
export const listingColumns = {
  id: listings.id,
  title: listings.title,
  description: listings.description,
  price: listings.price,
  imageUrl: listings.imageUrl,
  status: listings.status,
  sellerId: listings.sellerId,
  categoryId: listings.categoryId,
  createdAt: listings.createdAt,
  updatedAt: listings.updatedAt,
} as const;

export type ParsedSearchMode =
  | { ok: true; mode: SearchMode }
  | { ok: false; error: string };

/** Resolves the `mode` query parameter. */
export function parseSearchMode(raw: string | null): ParsedSearchMode {
  const value = raw?.trim().toLowerCase();
  if (!value) return { ok: true, mode: "keyword" };

  if ((SEARCH_MODES as readonly string[]).includes(value)) {
    return { ok: true, mode: value as SearchMode };
  }

  return {
    ok: false,
    error: `mode must be one of: ${SEARCH_MODES.join(", ")} (received "${raw}")`,
  };
}

/**
 * Fuses several rankings of ids into one, by reciprocal rank fusion.
 *
 * `score(d) = Σ 1 / (k + rank_i(d))`, ranks counted from 1. A document present in both
 * rankings beats one that tops a single ranking, which is exactly what hybrid mode is for.
 * A document present in only one ranking is kept, not dropped — that is the only path by
 * which a listing whose embedding is NULL can be found at all (AC6).
 */
export function reciprocalRankFusion(
  rankings: number[][],
  k: number = RRF_K,
): { id: number; score: number }[] {
  const scores = new Map<number, number>();
  // Insertion order gives a deterministic tie-break, so equal scores cannot reorder
  // between calls and duplicate a row across pages (AC8).
  const seen: number[] = [];

  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      if (!scores.has(id)) seen.push(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }

  return seen
    .map((id) => ({ id, score: scores.get(id)! }))
    .sort((a, b) => b.score - a.score || seen.indexOf(a.id) - seen.indexOf(b.id));
}

// ─── Query building ───────────────────────────────────────────────────────────

export type ListingQuery = {
  page: number;
  limit: number;
  mode: SearchMode;
  search: string;
  where: SQL | undefined;
  orderBy: SQL;
};

/**
 * Parses and validates the query string.
 *
 * The visibility block is moved here verbatim from the route: it is a security fix that
 * predates this epic, and AC12 is its regression test. Relocating it must not reinterpret
 * it.
 */
export function buildListingQuery(
  searchParams: URLSearchParams,
  payload: TokenPayload | null,
): { ok: true; query: ListingQuery } | { ok: false; error: string } {
  const mode = parseSearchMode(searchParams.get("mode"));
  if (!mode.ok) return { ok: false, error: mode.error };

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20),
  );

  const { includeAllStatuses, sellerFilter } = resolveListingVisibility(
    searchParams.get("sellerId"),
    payload,
  );

  const conditions: SQL[] = includeAllStatuses ? [] : [eq(listings.status, "active")];

  if (sellerFilter !== null) conditions.push(eq(listings.sellerId, sellerFilter));

  const categoryId = searchParams.get("categoryId");
  if (categoryId) {
    const id = parseInt(categoryId, 10);
    if (!isNaN(id)) conditions.push(eq(listings.categoryId, id));
  }

  const minPrice = searchParams.get("minPrice");
  if (minPrice) {
    const val = parseFloat(minPrice);
    if (!isNaN(val)) conditions.push(gte(listings.price, String(val)));
  }

  const maxPrice = searchParams.get("maxPrice");
  if (maxPrice) {
    const val = parseFloat(maxPrice);
    if (!isNaN(val)) conditions.push(lte(listings.price, String(val)));
  }

  const search = searchParams.get("search")?.trim() ?? "";
  // The keyword predicate belongs to the keyword arm only; semantic mode filters by
  // distance instead, and hybrid runs the two arms independently.
  const keywordConditions =
    search && mode.mode === "keyword"
      ? [...conditions, ilike(listings.title, `%${search}%`)]
      : conditions;

  const sortParam = searchParams.get("sort") ?? "newest";
  const orderBy =
    sortParam === "oldest"
      ? asc(listings.createdAt)
      : sortParam === "price_asc"
        ? asc(listings.price)
        : sortParam === "price_desc"
          ? desc(listings.price)
          : desc(listings.createdAt);

  return {
    ok: true,
    query: {
      page,
      limit,
      // AC10: an empty search term has nothing to embed, so the vector modes have nothing
      // to do. Falling back beats embedding "" and ranking every row against noise.
      mode: search ? mode.mode : "keyword",
      search,
      where: and(...keywordConditions),
      orderBy,
    },
  };
}

// ─── Execution ────────────────────────────────────────────────────────────────

/** A listing as a client sees it: every public column, plus AI-7's optional score. */
export type ListingRow = {
  [K in keyof typeof listingColumns]: (typeof listings.$inferSelect)[K];
} & { similarity?: number };

export type ListingPage = {
  data: ListingRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

/** Runs the query for whichever mode was requested. */
export async function runListingQuery(query: ListingQuery): Promise<ListingPage> {
  const rows =
    query.mode === "keyword"
      ? await runKeyword(query)
      : query.mode === "semantic"
        ? await runSemantic(query)
        : await runHybrid(query);

  return rows;
}

async function runKeyword(query: ListingQuery): Promise<ListingPage> {
  const offset = (query.page - 1) * query.limit;

  // Unchanged from before this story: AC1 requires byte-identical output.
  const [data, [{ total }]] = await Promise.all([
    db
      .select(listingColumns)
      .from(listings)
      .where(query.where)
      .orderBy(query.orderBy)
      .limit(query.limit)
      .offset(offset),
    db.select({ total: count() }).from(listings).where(query.where),
  ]);

  return paginate(data, total, query);
}

/** Ids and similarities above the floor, most similar first. */
async function vectorArm(
  query: ListingQuery,
): Promise<{ id: number; similarity: number }[]> {
  const embedding = await getEmbeddingProvider().embed(query.search);
  // A bound parameter, not `sql.raw`. Interpolating into a `sql` template binds; building
  // the literal as a string would put provider output straight into the statement text,
  // defeat statement caching, and turn a single non-finite float into a syntax error.
  // `backfill-embeddings.ts` already writes vectors this way.
  const literal = sql`${JSON.stringify(embedding)}::vector`;

  // `1 - (embedding <=> $1)` is cosine similarity, since AI-2 emits unit vectors.
  // `embedding IS NOT NULL` is implicit in the similarity comparison, but stated so the
  // planner can use the HNSW index and so the intent is readable.
  const rows = await db
    .select({
      id: listings.id,
      similarity: sql<number>`1 - (${listings.embedding} <=> ${literal})`,
    })
    .from(listings)
    .where(
      and(
        query.where,
        sql`${listings.embedding} IS NOT NULL`,
        sql`1 - (${listings.embedding} <=> ${literal}) >= ${MIN_SIMILARITY}`,
      ),
    )
    .orderBy(sql`${listings.embedding} <=> ${literal}`)
    .limit(FUSION_CANDIDATES);

  return rows.map((row) => ({ id: row.id, similarity: Number(row.similarity) }));
}

async function runSemantic(query: ListingQuery): Promise<ListingPage> {
  const ranked = await vectorArm(query);

  // AC8: `total` is the count of rows above the floor, not the size of the table. A real
  // behavioural difference between modes, and one Swagger documents.
  const offset = (query.page - 1) * query.limit;
  const pageIds = ranked.slice(offset, offset + query.limit);

  const similarityById = new Map(ranked.map((r) => [r.id, r.similarity]));
  const rows = await fetchByIds(pageIds.map((r) => r.id));

  return paginate(
    pageIds.map((r) => ({ ...rows.get(r.id)!, similarity: similarityById.get(r.id)! })),
    ranked.length,
    query,
  );
}

async function runHybrid(query: ListingQuery): Promise<ListingPage> {
  const [keywordIds, semantic] = await Promise.all([
    db
      .select({ id: listings.id })
      .from(listings)
      .where(and(query.where, ilike(listings.title, `%${query.search}%`)))
      .orderBy(query.orderBy)
      .limit(FUSION_CANDIDATES)
      .then((rows) => rows.map((row) => row.id)),
    vectorArm(query),
  ]);

  const fused = reciprocalRankFusion([keywordIds, semantic.map((r) => r.id)]);

  const offset = (query.page - 1) * query.limit;
  const pageIds = fused.slice(offset, offset + query.limit);
  const similarityById = new Map(semantic.map((r) => [r.id, r.similarity]));
  const rows = await fetchByIds(pageIds.map((r) => r.id));

  return paginate(
    pageIds.map((entry) => {
      const row = rows.get(entry.id)!;
      const similarity = similarityById.get(entry.id);
      // Absent, not 0, for a keyword-only match: a zero would read as "compared and scored
      // nothing", which is false — it was never in the vector arm at all (AC6).
      return similarity === undefined ? row : { ...row, similarity };
    }),
    fused.length,
    query,
  );
}

async function fetchByIds(ids: number[]): Promise<Map<number, ListingRow>> {
  if (ids.length === 0) return new Map();

  const rows = await db.select(listingColumns).from(listings).where(inArray(listings.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

function paginate(data: ListingRow[], total: number, query: ListingQuery): ListingPage {
  return {
    data,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}
