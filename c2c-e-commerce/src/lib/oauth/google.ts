// ─── Google ───────────────────────────────────────────────────────────────────
// Authorization code + PKCE (S256) + state + nonce (C2C-SEC-6).

import {
  createCodeVerifier,
  createOpaqueValue,
  deriveCodeChallenge,
} from "./state";
import {
  OAuthError,
  type AuthorizationRequest,
  type NormalizedProfile,
  type OAuthProviderClient,
} from "./types";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** OpenID Connect: `openid` is what makes this an identity flow rather than API access. */
const SCOPE = "openid email profile";

type GoogleTokenResponse = { access_token?: string; error?: string };

type GoogleUserInfo = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export function googleProvider(): OAuthProviderClient {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

  return {
    id: "google",
    supportsPkce: true,

    getAuthorizationUrl({ redirectUri }): AuthorizationRequest {
      const state = createOpaqueValue();
      const nonce = createOpaqueValue();
      const codeVerifier = createCodeVerifier();

      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", SCOPE);
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", deriveCodeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");

      return { url: url.toString(), state, codeVerifier, nonce };
    },

    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      });

      // Omitted rather than sent empty: Google rejects a blank code_verifier outright.
      if (codeVerifier) body.set("code_verifier", codeVerifier);

      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const data = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

      // The upstream body is deliberately not interpolated into the message: it can
      // echo request parameters, and this string reaches logs.
      if (!response.ok || !data.access_token) {
        throw new OAuthError(
          "Google rejected the authorization code",
          "token_exchange_failed",
          response.status,
        );
      }

      return data.access_token;
    },

    async getUserInfo(accessToken): Promise<NormalizedProfile> {
      const response = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new OAuthError(
          "Could not read the Google profile",
          "profile_fetch_failed",
          response.status,
        );
      }

      const profile = (await response.json()) as GoogleUserInfo;

      if (!profile.email) {
        throw new OAuthError(
          "Google returned no email address",
          "no_verified_email",
        );
      }

      return {
        providerAccountId: profile.sub,
        email: profile.email,
        // Read, never assumed. An unverified address must not silently link to an
        // existing account (decision D9).
        emailVerified: profile.email_verified === true,
        name: profile.name ?? null,
        avatarUrl: profile.picture ?? null,
      };
    },
  };
}
