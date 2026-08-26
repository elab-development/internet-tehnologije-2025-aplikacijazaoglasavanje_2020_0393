/**
 * C2C-QA-3 — the deterministic semantic fixture catalogue.
 *
 * SPEC PHASE SKELETON.
 */
const NOT_IMPLEMENTED = "not implemented — C2C-QA-3 is in its spec phase";

export const SEMANTIC_CLUSTERS = ["cycling", "phones", "furniture"] as const;

export type SemanticCluster = (typeof SEMANTIC_CLUSTERS)[number];

export type CatalogueEntry = {
  id: number;
  title: string;
  cluster: SemanticCluster;
  embedding: number[];
};

/** Inserts the catalogue into the test database and returns what it created. */
export function loadSemanticCatalogue(): Promise<CatalogueEntry[]> {
  throw new Error(NOT_IMPLEMENTED);
}
