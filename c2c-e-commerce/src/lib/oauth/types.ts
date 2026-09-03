// ─── OAuth2 provider contract ─────────────────────────────────────────────────
// One interface over two providers that differ in a way that matters (C2C-SEC-6).

import type { OAuthProvider as ProviderName } from "@/db/schema";

export type { ProviderName };

export type OAuthFailure =
  | "token_exchange_failed"
  | "profile_fetch_failed"
  | "no_verified_email"
  | "provider_unavailable";

export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly reason: OAuthFailure,
    /** Upstream status, when there was one. Never the response body. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

/** The two providers' very different payloads, reduced to what this app needs. */
export type NormalizedProfile = {
  /** Stable at the provider. The join key — see the unique index on oauth_accounts. */
  providerAccountId: string;
  email: string;
  /**
   * Whether the *provider* vouches for the address. Never assumed: linking an
   * unverified address to an existing account is a takeover vector (decision D9).
   */
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
};

/** Everything the callback will need to finish what an initiation started. */
export type AuthorizationRequest = {
  url: string;
  state: string;
  /** Google only. GitHub OAuth Apps have no PKCE, so there is nothing to verify. */
  codeVerifier?: string;
  nonce?: string;
};

export interface OAuthProviderClient {
  readonly id: ProviderName;

  /**
   * Whether this provider implements RFC 7636.
   *
   * Explicit in the interface rather than inferred, because the honest answer differs
   * per provider and callers must be able to see that rather than assume a shared code
   * path protects both.
   */
  readonly supportsPkce: boolean;

  getAuthorizationUrl(opts: { redirectUri: string }): AuthorizationRequest;

  exchangeCode(opts: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<string>;

  getUserInfo(accessToken: string): Promise<NormalizedProfile>;
}
