import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

/**
 * Mirrors the segments Task 24 marked `robots: { index: false }` in their layouts,
 * plus `/api/` (never a page, never worth crawling).
 *
 * `/listings/[id]` and `/users/[id]` are deliberately absent: those layouts only set
 * `index: false` conditionally (a missing or non-public row), so the routes stay
 * crawlable in general — the good case is exactly what `sitemap.ts` advertises.
 * Everything listed below is unconditionally private (behind `ProtectedRoute`), so a
 * blanket disallow is correct:
 *   - `/settings/layout.tsx`
 *   - `/listings/new/layout.tsx`
 *   - `/listings/[id]/edit/layout.tsx` -> `/listings/*\/edit`
 *   - `/link-account/layout.tsx`
 *   - `/orders/layout.tsx` and `/orders/[id]/layout.tsx` -> `/orders` (prefix covers both)
 *   - `/seller/layout.tsx`
 */
/**
 * Rendered per request, for the same reason as `sitemap.ts`: `siteUrl()` reads the
 * runtime environment, and a prerendered robots.txt would advertise whatever origin
 * the build container had -- `http://localhost:3000` when the build environment does
 * not carry `OAUTH_REDIRECT_BASE_URL`.
 */
export const dynamic = "force-dynamic";

const DISALLOW = [
  "/api/",
  "/orders",
  "/settings",
  "/seller",
  "/listings/new",
  "/listings/*/edit",
  "/link-account",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
