/**
 * C2C-AI-3 spec — the Drizzle schema half, which needs no database.
 *
 * The migrations are the source of truth for what Postgres actually holds; these tests
 * assert the schema *declaration* agrees with them, so a query built through Drizzle
 * cannot silently disagree with the column it targets.
 *
 * Columns are reached through a loose record rather than the inferred table type. In a
 * Drizzle schema the declaration *is* the type, so asserting on a column that does not
 * exist yet would be a compile error rather than a test failure — and the spec phase is
 * supposed to leave the suite red, not the typechecker.
 */
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";

import { listings } from "./listings";

type ColumnLike = {
  name: string;
  notNull: boolean;
  getSQLType(): string;
  /** Present on `vector` columns. */
  dimensions?: number;
};

const columns = getTableColumns(listings) as unknown as Record<
  string,
  ColumnLike | undefined
>;

function column(name: string): ColumnLike {
  const found = columns[name];
  if (!found) {
    throw new Error(
      `listings schema declares no "${name}" column (has: ${Object.keys(columns).join(", ")})`,
    );
  }
  return found;
}

describe("C2C-AI-3 — listings schema", () => {
  it("AC2: declares an `embedding` column", () => {
    expect(Object.keys(columns)).toContain("embedding");
    expect(column("embedding").name).toBe("embedding");
  });

  it("AC2: the embedding column is a 384-dimension vector", () => {
    expect(column("embedding").getSQLType()).toBe("vector(384)");
    expect(column("embedding").dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("AC2: the embedding column is nullable, so a failed embed cannot block a write", () => {
    // AI-4 AC2 depends on this: an embedding failure must still produce a 201.
    expect(column("embedding").notNull).toBe(false);
  });

  it("AC2: declares a nullable `embedding_updated_at` timestamp", () => {
    expect(Object.keys(columns)).toContain("embeddingUpdatedAt");
    expect(column("embeddingUpdatedAt").name).toBe("embedding_updated_at");
    expect(column("embeddingUpdatedAt").getSQLType()).toBe("timestamp");
    expect(column("embeddingUpdatedAt").notNull).toBe(false);
  });

  it("AC2: takes its width from EMBEDDING_DIMENSIONS rather than repeating the literal", () => {
    // One source of truth, per AI-2: if the model ever changes width, the schema follows.
    expect(column("embedding").getSQLType()).toBe(`vector(${EMBEDDING_DIMENSIONS})`);
  });

  it("AC-updated-at: declares a non-null `updated_at` timestamp", () => {
    // Added by C2C-AI-4. AI-4 AC5's staleness query is
    // `embedding_updated_at < updated_at`, and no table in this schema had an updated_at
    // before — the query the backlog specifies could not be written at all.
    expect(Object.keys(columns)).toContain("updatedAt");
    expect(column("updatedAt").name).toBe("updated_at");
    expect(column("updatedAt").getSQLType()).toBe("timestamp");
    expect(column("updatedAt").notNull).toBe(true);
  });

  it("leaves the pre-existing columns untouched", () => {
    for (const name of [
      "id",
      "title",
      "description",
      "price",
      "status",
      "sellerId",
      "categoryId",
      "createdAt",
    ]) {
      expect(Object.keys(columns)).toContain(name);
    }
  });
});
