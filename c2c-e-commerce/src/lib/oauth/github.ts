// ─── GitHub ───────────────────────────────────────────────────────────────────
// Authorization code + state, and deliberately NO PKCE (C2C-SEC-6).
//
// GitHub OAuth Apps do not implement RFC 7636: there is no `code_challenge` parameter
// on the authorize endpoint, and sending one changes nothing. Writing a shared
// "PKCE for everyone" helper would therefore produce a code path that looks protected
// and is not, which is worse than an honest asymmetry. What stands in for it here is
// the client secret plus `state`.

import { createOpaqueValue } from "./state";
import {
  OAuthError,
  type AuthorizationRequest,
  type NormalizedProfile,
  type OAuthProviderClient,
} from "./types";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const EMAILS_URL = "https://api.github.com/user/emails";

const SCOPE = "read:user user:email";

type GitHubTokenResponse = { access_token?: string; error?: string };

type GitHubUser = {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

type GitHubEmail = { email: string; primary: boolean; verified: boolean };

export function githubProvider(): OAuthProviderClient {
  const clientId = process.env.GITHUB_CLIENT_ID ?? "";
  const clientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";

  return {
    id: "github",
    supportsPkce: false,

    getAuthorizationUrl({ redirectUri }): AuthorizationRequest {
      const state = createOpaqueValue();

      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", SCOPE);
      url.searchParams.set("state", state);

      // No code_challenge. See the note at the top of this file.
      return { url: url.toString(), state };
    },

    async exchangeCode({ code, redirectUri }) {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Without this GitHub answers form-encoded, and `response.json()` throws.
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as GitHubTokenResponse;

      // GitHub answers 200 with {"error": "bad_verification_code"} on a bad code, so
      // the status alone is not the signal — trusting it carries an undefined token
      // into the next request.
      if (!response.ok || data.error || !data.access_token) {
        throw new OAuthError(
          "GitHub rejected the authorization code",
          "token_exchange_failed",
          response.status,
        );
      }

      return data.access_token;
    },

    async getUserInfo(accessToken): Promise<NormalizedProfile> {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      };

      const response = await fetch(USER_URL, { headers });
      if (!response.ok) {
        throw new OAuthError(
          "Could not read the GitHub profile",
          "profile_fetch_failed",
          response.status,
        );
      }

      const user = (await response.json()) as GitHubUser;

      const base = {
        providerAccountId: String(user.id),
        name: user.name ?? user.login ?? null,
        avatarUrl: user.avatar_url ?? null,
      };

      // A public address on the profile is already verified at GitHub.
      if (user.email) {
        return { ...base, email: user.email, emailVerified: true };
      }

      // Hidden address: ask for the list. Both flags matter — `primary` picks the one
      // the user considers theirs, `verified` is what SEC-8's linking policy requires.
      const emailsResponse = await fetch(EMAILS_URL, { headers });
      if (!emailsResponse.ok) {
        throw new OAuthError(
          "Could not read the GitHub email addresses",
          "profile_fetch_failed",
          emailsResponse.status,
        );
      }

      const emails = (await emailsResponse.json()) as GitHubEmail[];
      const primary = emails.find((entry) => entry.primary && entry.verified);

      if (!primary) {
        throw new OAuthError(
          "This GitHub account has no verified primary email address",
          "no_verified_email",
        );
      }

      return { ...base, email: primary.email, emailVerified: true };
    },
  };
}
