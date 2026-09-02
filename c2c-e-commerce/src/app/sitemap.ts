import type { MetadataRoute } from "next";

import { activeListingsForSitemap } from "@/lib/listing-metadata";
import { siteUrl } from "@/lib/site-url";

/**
 * Public routes worth indexing. Everything behind `ProtectedRoute` (`/orders`,
 * `/settings`, `/seller`, `/listings/new`, `/link-account`, and the edit/detail pages
 * that require auth) is deliberately omitted — see `robots.ts` for the matching
 * disallow list.
 */
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
