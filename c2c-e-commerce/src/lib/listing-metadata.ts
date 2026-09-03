import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { listings, users } from "@/db/schema";
import { isPubliclyVisible } from "@/lib/listing-visibility";

/**
 * Server-only door into the database for `src/app/(frontend)` (spec D10).
 *
 * Before this file, nothing under `(frontend)` imported from `src/db` — every page there
 * talks to the database through the API routes, over `fetch`, from the browser. The
 * segment `layout.tsx` files that call the functions below are the first exception, and
 * they are server components specifically so this import is legal: a client component
 * that tried to import `@/db` would fail to compile, which is what keeps this a single
 * door rather than a pattern that spreads.
 */

/**
 * The fields `generateMetadata` needs for one listing, or null if it must not be shown.
 *
 * Resolves as ANONYMOUS on purpose (spec D8). Reading the session would make the served
 * HTML vary by cookie — a caching hazard — and risks putting a draft's title into a
 * <meta> tag or a link preview. `reserved` and `sold` are publicly readable, so a
 * shared link to a completed sale still previews correctly.
 */
export async function listingForMetadata(
  id: number,
): Promise<{ title: string; description: string } | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

  const [row] = await db
    .select({
      title: listings.title,
      description: listings.description,
      status: listings.status,
    })
    .from(listings)
    .where(eq(listings.id, id))
    .limit(1);

  if (!row || !isPubliclyVisible(row.status)) return null;

  return { title: row.title, description: row.description };
}

/**
 * The name for a seller-profile page's title. A seller's profile is public regardless of
 * their listings' statuses (their review feed and `active` listings are always visible),
 * so this is a plain existence lookup rather than a visibility check.
 */
export async function sellerForMetadata(id: number): Promise<{ name: string } | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return row ?? null;
}

/**
 * Listings the sitemap should advertise.
 *
 * `active` only — deliberately narrower than `listingForMetadata`'s rule (spec D9).
 * `listingForMetadata` uses `isPubliclyVisible`, which also lets `reserved` and `sold`
 * through, because a shared link to a completed sale should still preview correctly.
 * The sitemap has a different job: it tells a crawler what to advertise as available.
 * A reserved or sold listing is readable if you have the link, but it is not for sale,
 * so pointing search traffic at it produces a bad result page. Do not fold this back
 * into `isPubliclyVisible` — the two rules answer different questions and are meant to
 * diverge.
 *
 * Seller profiles are deliberately excluded from the sitemap despite being public: they
 * are thin pages (a name and a review feed), and adding one entry per seller roughly
 * doubles the query surface here for little indexing value.
 *
 * Capped because a Next.js sitemap holds at most 50,000 URLs. If the active catalogue
 * ever approaches that, split it with `generateSitemaps` rather than raising this cap.
 */
export async function activeListingsForSitemap(
  limit = 10_000,
): Promise<Array<{ id: number; updatedAt: Date }>> {
  return db
    .select({ id: listings.id, updatedAt: listings.updatedAt })
    .from(listings)
    .where(eq(listings.status, "active"))
    .orderBy(desc(listings.updatedAt))
    .limit(limit);
}
