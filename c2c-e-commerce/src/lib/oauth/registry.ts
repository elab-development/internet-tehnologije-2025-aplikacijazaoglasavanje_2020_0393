// ─── Provider registry ────────────────────────────────────────────────────────
// Which providers this deployment actually offers (C2C-SEC-6 AC10).
//
// A provider whose credentials are absent is absent from the registry entirely, rather
// than present and half-built. Handing back a Google client with `client_id=undefined`
// would produce a redirect that fails confusingly at Google's end; returning null here
// lets the route answer with a clean 404 and lets the login page hide the button.

import { githubProvider } from "./github";
import { googleProvider } from "./google";
import { mockProvider } from "./mock";
import type { OAuthProviderClient, ProviderName } from "./types";

const PROVIDERS: ProviderName[] = ["google", "github"];

/** Treats an empty string as unset: `GOOGLE_CLIENT_ID=` in a .env is a mistake. */
function configured(name: string): boolean {
  return (process.env[name] ?? "").trim().length > 0;
}

function usingMock(): boolean {
  return process.env.OAUTH_PROVIDER === "mock";
}

function isConfigured(provider: ProviderName): boolean {
  if (usingMock()) return true;

  const prefix = provider === "google" ? "GOOGLE" : "GITHUB";
  // Both halves: an id without a secret cannot complete the exchange.
  return configured(`${prefix}_CLIENT_ID`) && configured(`${prefix}_CLIENT_SECRET`);
}

/** The providers a client may actually offer, in a stable order. */
export function availableProviders(): ProviderName[] {
  return PROVIDERS.filter(isConfigured);
}

/** The client for `name`, or null when unknown or unconfigured. */
export function getOAuthProvider(name: string): OAuthProviderClient | null {
  if (!PROVIDERS.includes(name as ProviderName)) return null;

  const provider = name as ProviderName;
  if (!isConfigured(provider)) return null;

  if (usingMock()) return mockProvider(provider);
  return provider === "google" ? googleProvider() : githubProvider();
}

/**
 * The callback URL registered with the provider.
 *
 * Built from configuration rather than the incoming request: deriving it from a `Host`
 * header would let an attacker-supplied host end up in the redirect_uri.
 */
export function redirectUriFor(provider: ProviderName | string): string {
  const base = (process.env.OAUTH_REDIRECT_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/auth/oauth/${provider}/callback`;
}
