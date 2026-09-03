import type { MetadataRoute } from "next";

import { activeListingsForSitemap } from "@/lib/listing-metadata";
import { siteUrl } from "@/lib/site-url";

/**
 * Public routes worth indexing. Everything behind `ProtectedRoute` (`/orders`,
 * `/settings`, `/seller`, `/listings/new`, `/link-account`, and the edit/detail pages
 * that require auth) is deliberately omitted — see `robots.ts` for the matching
 * disallow list.
 */
/**
 * Rendered per request, not at build time.
 *
 * Next prerenders `sitemap.ts` by default, but this one reads the listings table, and
 * the Docker builder stage has no database to read -- the build died on
 * `Error occurred prerendering page "/sitemap.xml" ... ECONNREFUSED`. Request-time
 * rendering is also the correct semantics: a sitemap frozen at build time goes stale
 * the moment a seller publishes a listing, and `siteUrl()` resolves from the runtime
 * environment rather than baking whatever origin the build machine happened to have.
 */
export const dynamic = "force-dynamic";

const PUBLIC_ROUTES = ["", "/listings", "/login", "/register", "/api-docs"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const listings = await activeListingsForSitemap();

  return [
    ...PUBLIC_ROUTES.map((path) => ({
      url: `${base}${path}`,
      changeFrequency: "daily" as const,
      priority: path === "/listings" ? 1 : 0.5,
    })),
    ...listings.map((listing) => ({
      url: `${base}/listings/${listing.id}`,
      lastModified: listing.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
