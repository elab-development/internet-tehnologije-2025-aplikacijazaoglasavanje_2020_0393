/**
 * C2C-SEC-6 AC10/AC11 — the provider registry and the offline mock.
 *
 * A provider whose credentials are absent must be *absent*, not half-built: a registry
 * that hands back a Google provider with `client_id=undefined` produces a redirect to
 * Google that fails confusingly at the far end, instead of a clean 404 here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
  vi.unstubAllGlobals();
});

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const BOTH = {
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret",
  GITHUB_CLIENT_ID: "gh-id",
  GITHUB_CLIENT_SECRET: "gh-secret",
  OAUTH_REDIRECT_BASE_URL: "http://localhost:3000",
};

const registry = async () => import("./registry");

describe("C2C-SEC-6 AC10 — providers appear only when configured", () => {
  it("lists both when both are configured", async () => {
    setEnv(BOTH);

    expect((await registry()).availableProviders().sort()).toEqual(["github", "google"]);
  });

  it("omits GitHub when its client id is missing", async () => {
    setEnv({ ...BOTH, GITHUB_CLIENT_ID: undefined });

    const { availableProviders, getOAuthProvider } = await registry();

    expect(availableProviders()).toEqual(["google"]);
    // Null rather than a throw: the route turns this into a 404.
    expect(getOAuthProvider("github")).toBeNull();
  });

  it("omits a provider whose secret is missing, not just its id", async () => {
    setEnv({ ...BOTH, GOOGLE_CLIENT_SECRET: undefined });

    expect((await registry()).availableProviders()).toEqual(["github"]);
  });

  it("treats an empty string as unconfigured", async () => {
    // A .env line like `GOOGLE_CLIENT_ID=` is a mistake, not a configuration.
    setEnv({ ...BOTH, GOOGLE_CLIENT_ID: "" });

    expect((await registry()).availableProviders()).toEqual(["github"]);
  });

  it("returns null for a provider name that does not exist", async () => {
    setEnv(BOTH);

    expect((await registry()).getOAuthProvider("facebook")).toBeNull();
  });

  it("does not crash when nothing is configured at all", async () => {
    setEnv({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    });

    const { availableProviders, getOAuthProvider } = await registry();

    expect(availableProviders()).toEqual([]);
    expect(getOAuthProvider("google")).toBeNull();
  });

  it("builds a redirect URI from OAUTH_REDIRECT_BASE_URL", async () => {
    setEnv({ ...BOTH, OAUTH_REDIRECT_BASE_URL: "https://c2c.example" });

    expect((await registry()).redirectUriFor("google")).toBe(
      "https://c2c.example/api/auth/oauth/google/callback",
    );
  });

  it("tolerates a trailing slash on the base URL", async () => {
    setEnv({ ...BOTH, OAUTH_REDIRECT_BASE_URL: "https://c2c.example/" });

    expect((await registry()).redirectUriFor("google")).toBe(
      "https://c2c.example/api/auth/oauth/google/callback",
    );
  });
});

describe("C2C-SEC-6 AC11 — the mock provider", () => {
  it("is available when OAUTH_PROVIDER=mock, with no credentials at all", async () => {
    setEnv({
      OAUTH_PROVIDER: "mock",
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
      OAUTH_REDIRECT_BASE_URL: "http://localhost:3000",
    });

    expect((await registry()).availableProviders()).toContain("google");
  });

  it("runs the whole flow without a network call", async () => {
    setEnv({ OAUTH_PROVIDER: "mock", OAUTH_REDIRECT_BASE_URL: "http://localhost:3000" });

    // Any fetch at all is a failure: CI must never depend on Google being up.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { getOAuthProvider, redirectUriFor } = await registry();
    const provider = getOAuthProvider("google")!;

    const request = provider.getAuthorizationUrl({
      redirectUri: redirectUriFor("google"),
    });
    const token = await provider.exchangeCode({
      code: "mock-code",
      redirectUri: redirectUriFor("google"),
      codeVerifier: request.codeVerifier,
    });
    const profile = await provider.getUserInfo(token);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(profile.providerAccountId).toBeTruthy();
    expect(profile.email).toBeTruthy();
    expect(profile.emailVerified).toBe(true);
  });

  it("is deterministic for the same code, so tests can assert on the identity", async () => {
    setEnv({ OAUTH_PROVIDER: "mock", OAUTH_REDIRECT_BASE_URL: "http://localhost:3000" });
    const { getOAuthProvider } = await registry();
    const provider = getOAuthProvider("google")!;

    const first = await provider.getUserInfo(
      await provider.exchangeCode({ code: "ada", redirectUri: "http://x" }),
    );
    const second = await provider.getUserInfo(
      await provider.exchangeCode({ code: "ada", redirectUri: "http://x" }),
    );

    expect(first).toEqual(second);
  });

  it("gives different codes different identities", async () => {
    setEnv({ OAUTH_PROVIDER: "mock", OAUTH_REDIRECT_BASE_URL: "http://localhost:3000" });
    const { getOAuthProvider } = await registry();
    const provider = getOAuthProvider("google")!;

    const ada = await provider.getUserInfo(
      await provider.exchangeCode({ code: "ada", redirectUri: "http://x" }),
    );
    const grace = await provider.getUserInfo(
      await provider.exchangeCode({ code: "grace", redirectUri: "http://x" }),
    );

    expect(ada.providerAccountId).not.toBe(grace.providerAccountId);
  });

  it("keeps the PKCE asymmetry visible even in the mock", async () => {
    setEnv({ OAUTH_PROVIDER: "mock", OAUTH_REDIRECT_BASE_URL: "http://localhost:3000" });
    const { getOAuthProvider } = await registry();

    // Otherwise a test suite passing against the mock would prove nothing about the
    // difference SEC-7 has to handle.
    expect(getOAuthProvider("google")!.supportsPkce).toBe(true);
    expect(getOAuthProvider("github")!.supportsPkce).toBe(false);
  });
});
