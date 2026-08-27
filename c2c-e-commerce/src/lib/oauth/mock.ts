// ─── Mock provider ────────────────────────────────────────────────────────────
// Exercises the whole flow with no network (C2C-SEC-6 AC11), mirroring AI-1's approach.
//
// Deterministic per code, so a test can assert on the identity it gets back; distinct
// per code, so two "users" in one test are actually two users.

import { createHash } from "node:crypto";

import { createCodeVerifier, createOpaqueValue, deriveCodeChallenge } from "./state";
import {
  type AuthorizationRequest,
  type NormalizedProfile,
  type OAuthProviderClient,
  type ProviderName,
} from "./types";

/** Encodes the code into the token so getUserInfo can recover it without shared state. */
const TOKEN_PREFIX = "mock-token:";

export function mockProvider(id: ProviderName): OAuthProviderClient {
  // The asymmetry is preserved deliberately: a suite that passes against a mock where
  // both providers "support" PKCE would prove nothing about the branch SEC-7 has to
  // handle for real.
  const supportsPkce = id === "google";

  return {
    id,
    supportsPkce,

    getAuthorizationUrl({ redirectUri }): AuthorizationRequest {
      const state = createOpaqueValue();
      const url = new URL(`https://mock-oauth.test/${id}/authorize`);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);

      if (!supportsPkce) return { url: url.toString(), state };

      const codeVerifier = createCodeVerifier();
      const nonce = createOpaqueValue();
      url.searchParams.set("code_challenge", deriveCodeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("nonce", nonce);

      return { url: url.toString(), state, codeVerifier, nonce };
    },

    async exchangeCode({ code }) {
      return `${TOKEN_PREFIX}${code}`;
    },

    async getUserInfo(accessToken): Promise<NormalizedProfile> {
      const code = accessToken.startsWith(TOKEN_PREFIX)
        ? accessToken.slice(TOKEN_PREFIX.length)
        : accessToken;

      const digest = createHash("sha256").update(`${id}:${code}`).digest("hex");

      return {
        providerAccountId: digest.slice(0, 16),
        email: `${code}@mock-oauth.test`,
        emailVerified: true,
        name: `Mock ${code}`,
        avatarUrl: null,
      };
    },
  };
}
