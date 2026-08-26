/**
 * C2C-QA-3 — the deterministic semantic fixture catalogue.
 *
 * Twenty-one listings in three clusters, each with a vector that genuinely sits near its
 * own cluster and far from the others. AI-7 AC2, AI-9 AC1 and AI-10 AC7 are all written
 * against this, and it doubles as the thesis evaluation dataset.
 *
 * **Why the vectors are structured rather than hashed.** The obvious reading of "mock
 * embeddings" is `MockEmbeddingProvider`, whose FNV-1a-seeded vectors are deliberately
 * unrelated to meaning. Those are right for AI-4's write path, where only determinism and
 * distinctness matter, and useless here: cycling listings would sit no nearer each other
 * than to furniture, so "the recommender ranked a bicycle first" would be a coin flip.
 *
 * Instead each cluster owns a disjoint band of the 384 dimensions. A listing's vector is
 * its cluster's band plus a small, deterministic, title-seeded perturbation, then
 * L2-normalised. Disjoint bands rather than random centroids because two random centroids
 * can land close together by chance and fail the self-check for no good reason.
 *
 * *Rejected:* real vectors from `LocalEmbeddingProvider`. They cluster more honestly, but
 * they cost a model load in every integration file and tie the fixtures to a model
 * version — a thesis dataset that shifts when the model updates is worse than one that is
 * synthetic and stable. AI-2's `embeddings.model.test.ts` already proves the real model
 * clusters; this file's job is a stable input for ranking code.
 */
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";

import { makeCategory, makeListing, makeUser } from "../factories";

export const SEMANTIC_CLUSTERS = ["cycling", "phones", "furniture"] as const;

export type SemanticCluster = (typeof SEMANTIC_CLUSTERS)[number];

export type CatalogueEntry = {
  id: number;
  title: string;
  cluster: SemanticCluster;
  embedding: number[];
};

type Seed = { title: string; description: string; price: string };

/**
 * The catalogue's text.
 *
 * Written so the *words* cluster too, not only the vectors: AI-7's hybrid mode fuses a
 * keyword arm with a vector arm, and a query like "bike" must find something through
 * both. Titles deliberately avoid sharing vocabulary across clusters.
 */
const SEEDS: Record<SemanticCluster, Seed[]> = {
  cycling: [
    { title: "Aluminium mountain bike, 26 inch wheels", description: "Hardtail frame, recently serviced, good for trails.", price: "220.00" },
    { title: "Second-hand road bicycle", description: "Lightweight racing bike with drop handlebars.", price: "340.00" },
    { title: "Children's BMX bike", description: "Small frame, sturdy tyres, ideal for a first bicycle.", price: "80.00" },
    { title: "Cycling helmet, size medium", description: "Ventilated helmet for road and trail riding.", price: "35.00" },
    { title: "Bicycle repair tool kit", description: "Tyre levers, chain tool and spare inner tubes.", price: "25.00" },
    { title: "Electric bike with pannier rack", description: "Commuter e-bike, battery holds a full charge.", price: "900.00" },
    { title: "Gravel bike, carbon fork", description: "Wide tyres for mixed terrain riding.", price: "620.00" },
  ],
  phones: [
    { title: "iPhone 15 Pro, 256 GB", description: "Unlocked smartphone in excellent condition.", price: "780.00" },
    { title: "Samsung Galaxy S23", description: "Android handset with charger and original box.", price: "540.00" },
    { title: "Google Pixel 8", description: "Unlocked mobile phone, battery health above 90 percent.", price: "460.00" },
    { title: "Phone case for iPhone 15", description: "Silicone protective cover, barely used.", price: "12.00" },
    { title: "USB-C fast charger, 45 W", description: "Charges most modern smartphones quickly.", price: "18.00" },
    { title: "Refurbished iPhone 12", description: "Smartphone restored to factory condition.", price: "310.00" },
    { title: "Wireless charging pad", description: "Qi charging mat for phones and earbuds.", price: "22.00" },
  ],
  furniture: [
    { title: "Leather office chair", description: "Adjustable height, lumbar support, minor wear.", price: "150.00" },
    { title: "Walnut dining table, seats six", description: "Solid wood table with matching bench.", price: "480.00" },
    { title: "Two-seat fabric sofa", description: "Grey upholstered couch, smoke-free home.", price: "260.00" },
    { title: "Pine bookshelf, five shelves", description: "Tall wooden shelving unit for a study.", price: "95.00" },
    { title: "Bedside cabinet with drawer", description: "Small nightstand in oak veneer.", price: "45.00" },
    { title: "Standing desk, electric height adjustment", description: "Sit-stand workstation with memory presets.", price: "390.00" },
    { title: "Set of four stacking chairs", description: "Moulded seats on a steel frame, for a kitchen.", price: "70.00" },
  ],
};

/** FNV-1a, 32-bit — the same hash AI-1 and AI-2 use. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const BAND = Math.floor(EMBEDDING_DIMENSIONS / SEMANTIC_CLUSTERS.length);

/**
 * A unit vector that lies in `cluster`'s band, nudged by a title-seeded perturbation.
 *
 * The perturbation is what makes members of a cluster distinguishable — AI-9 has to *rank*
 * neighbours, so identical vectors would make its ordering arbitrary — while the band
 * dominates, so a member is always nearer its own cluster than another's.
 */
export function clusterEmbedding(cluster: SemanticCluster, title: string): number[] {
  const index = SEMANTIC_CLUSTERS.indexOf(cluster);
  const start = index * BAND;

  let state = fnv1a(`${cluster}:${title}`);
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => {
    const inBand = i >= start && i < start + BAND;
    // 1.0 inside the band against at most 0.05 outside it: the band decides which cluster
    // a vector belongs to, the noise only decides the order within it.
    return inBand ? 1 + random() * 0.35 : random() * 0.05;
  });

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

/**
 * Inserts the catalogue and returns what it created.
 *
 * One seller and one category per cluster, so `sameCategoryOnly=true` in AI-9 has
 * something to filter on and AI-10 has a seller whose own listings must be excluded.
 */
export async function loadSemanticCatalogue(): Promise<CatalogueEntry[]> {
  const seller = await makeUser({ role: "seller" });
  const entries: CatalogueEntry[] = [];

  for (const cluster of SEMANTIC_CLUSTERS) {
    const category = await makeCategory({ name: cluster, slug: cluster });

    for (const seed of SEEDS[cluster]) {
      const embedding = clusterEmbedding(cluster, seed.title);
      const listing = await makeListing({
        title: seed.title,
        description: seed.description,
        price: seed.price,
        sellerId: seller.id,
        categoryId: category.id,
        status: "active",
        embedding,
      });

      entries.push({ id: listing.id, title: seed.title, cluster, embedding });
    }
  }

  return entries;
}
