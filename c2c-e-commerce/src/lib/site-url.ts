/**
 * This app's public origin, for absolute URLs in the sitemap and robots files.
 *
 * Falls back to `OAUTH_REDIRECT_BASE_URL`, which already holds exactly this value and is
 * read from config rather than the `Host` header — that header is attacker-controlled.
 * One value, configured once; `SITE_URL` exists only for the rare case where the
 * crawler-facing origin genuinely differs from the OAuth callback origin.
 */
export function siteUrl(): string {
  const configured = process.env.SITE_URL ?? process.env.OAUTH_REDIRECT_BASE_URL;
  return (configured ?? "http://localhost:3000").replace(/\/+$/, "");
}
