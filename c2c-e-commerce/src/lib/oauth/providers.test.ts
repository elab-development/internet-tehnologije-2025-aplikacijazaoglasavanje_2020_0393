/**
 * C2C-SEC-6 spec — the two real providers.
 *
 * The asymmetry is the point, and it is the finding the thesis chapter is built on:
 * **Google supports PKCE and GitHub OAuth Apps do not.** There is no `code_challenge`
 * parameter in GitHub's authorize endpoint, so a single shared "PKCE for everyone" code
 * path would silently do nothing there while looking correct. These tests pin the
 * difference in both directions — Google must send a challenge, GitHub must not — so
 * nobody later "tidies up" the duplication and quietly removes a control.
 *
 * `fetch` is stubbed throughout. No test in this repository ever talks to Google.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Resolved lazily. `vi.resetModules()` gives each test a fresh module graph, so the
 * providers throw an OAuthError from a *different* instance of ./types than a
 * top-level import would hold -- and `instanceof` compares class identity, not shape.
 */
const OAuthErrorClass = async () => (await import("./types")).OAuthError;
type OAuthError = InstanceType<Awaited<ReturnType<typeof OAuthErrorClass>>>;

const ENV = {
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GITHUB_CLIENT_ID: "github-client-id",
  GITHUB_CLIENT_SECRET: "github-client-secret",
  OAUTH_REDIRECT_BASE_URL: "http://localhost:3000",
};

const REDIRECT = "http://localhost:3000/api/auth/oauth/google/callback";

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  Object.assign(process.env, ENV);
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
  vi.unstubAllGlobals();
});

/** Canned JSON responses, consumed in order. */
function stubFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const queue = [...responses];
  const calls: Array<{ url: string; init: RequestInit }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      return new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );

  return calls;
}

const google = async () => (await import("./google")).googleProvider();
const github = async () => (await import("./github")).githubProvider();

describe("C2C-SEC-6 AC1 — Google's authorization URL", () => {
  it("carries every parameter the flow depends on, including PKCE", async () => {
    const provider = await google();

    const request = provider.getAuthorizationUrl({ redirectUri: REDIRECT });
    const url = new URL(request.url);

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(ENV.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("scope")).toContain("email");
    expect(url.searchParams.get("scope")).toContain("profile");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("returns the verifier and nonce to the caller, not just the URL", async () => {
    const provider = await google();

    const request = provider.getAuthorizationUrl({ redirectUri: REDIRECT });

    // The callback cannot complete PKCE without them; they go into the tx cookie.
    expect(request.codeVerifier).toBeTruthy();
    expect(request.nonce).toBeTruthy();
    expect(url(request.url).searchParams.get("nonce")).toBe(request.nonce);
  });

  it("AC3: state and verifier differ between two calls", async () => {
    const provider = await google();

    const a = provider.getAuthorizationUrl({ redirectUri: REDIRECT });
    const b = provider.getAuthorizationUrl({ redirectUri: REDIRECT });

    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it("declares that it supports PKCE", async () => {
    expect((await google()).supportsPkce).toBe(true);
  });
});

describe("C2C-SEC-6 AC2 — GitHub's authorization URL", () => {
  it("carries state and scope but NO code_challenge", async () => {
    const provider = await github();

    const request = provider.getAuthorizationUrl({ redirectUri: REDIRECT });
    const parsed = url(request.url);

    expect(parsed.origin + parsed.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe(ENV.GITHUB_CLIENT_ID);
    expect(parsed.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(parsed.searchParams.get("state")).toBeTruthy();
    expect(parsed.searchParams.get("scope")).toContain("read:user");
    expect(parsed.searchParams.get("scope")).toContain("user:email");

    // GitHub OAuth Apps do not implement PKCE. Sending a challenge would be theatre:
    // the server ignores it, and the code path would look protected while it is not.
    expect(parsed.searchParams.get("code_challenge")).toBeNull();
    expect(parsed.searchParams.get("code_challenge_method")).toBeNull();
  });

  it("declares that it does not support PKCE, so callers cannot assume otherwise", async () => {
    expect((await github()).supportsPkce).toBe(false);
  });

  it("returns no verifier to store", async () => {
    const request = (await github()).getAuthorizationUrl({ redirectUri: REDIRECT });

    expect(request.codeVerifier).toBeUndefined();
  });

  it("AC3: a fresh state per call", async () => {
    const provider = await github();

    expect(
      provider.getAuthorizationUrl({ redirectUri: REDIRECT }).state,
    ).not.toBe(provider.getAuthorizationUrl({ redirectUri: REDIRECT }).state);
  });
});

describe("C2C-SEC-6 AC5 — exchanging the code", () => {
  it("sends the verifier to Google and returns the access token", async () => {
    const calls = stubFetch({ body: { access_token: "google-access-token" } });
    const provider = await google();

    const token = await provider.exchangeCode({
      code: "auth-code",
      redirectUri: REDIRECT,
      codeVerifier: "the-verifier",
    });

    expect(token).toBe("google-access-token");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0].init.body)).toContain("code_verifier=the-verifier");
  });

  it("rejects with a typed error when Google refuses the exchange", async () => {
    // What a mismatched verifier actually looks like on the wire.
    stubFetch({ status: 400, body: { error: "invalid_grant" } });
    const provider = await google();

    await expect(
      provider.exchangeCode({ code: "c", redirectUri: REDIRECT, codeVerifier: "wrong" }),
    ).rejects.toBeInstanceOf(await OAuthErrorClass());
  });

  it("asks GitHub for JSON, which it otherwise answers form-encoded", async () => {
    const calls = stubFetch({ body: { access_token: "github-access-token" } });
    const provider = await github();

    const token = await provider.exchangeCode({ code: "auth-code", redirectUri: REDIRECT });

    expect(token).toBe("github-access-token");
    expect(calls[0].url).toBe("https://github.com/login/oauth/access_token");
    expect(
      (calls[0].init.headers as Record<string, string>).Accept,
    ).toBe("application/json");
  });

  it("treats GitHub's 200-with-error-body as a failure", async () => {
    // GitHub answers 200 with {"error": "bad_verification_code"}. Trusting the status
    // code alone would carry an undefined token into the next step.
    stubFetch({ status: 200, body: { error: "bad_verification_code" } });
    const provider = await github();

    await expect(
      provider.exchangeCode({ code: "c", redirectUri: REDIRECT }),
    ).rejects.toBeInstanceOf(await OAuthErrorClass());
  });

  it("never puts the client secret in an error message", async () => {
    stubFetch({ status: 401, body: { error: "unauthorized_client" } });
    const provider = await google();

    const error = await provider
      .exchangeCode({ code: "c", redirectUri: REDIRECT, codeVerifier: "v" })
      .catch((e: Error) => e);

    expect(error.message).not.toContain(ENV.GOOGLE_CLIENT_SECRET);
  });
});

describe("C2C-SEC-6 AC8 — Google's profile", () => {
  it("reads email_verified from the provider rather than assuming true", async () => {
    stubFetch({
      body: {
        sub: "google-sub-1",
        email: "ada@example.test",
        email_verified: false,
        name: "Ada",
        picture: "https://example.test/a.png",
      },
    });

    const profile = await (await google()).getUserInfo("access-token");

    // Hard-coding true here is the account-takeover bug SEC-8's policy depends on us
    // not having.
    expect(profile.emailVerified).toBe(false);
    expect(profile.providerAccountId).toBe("google-sub-1");
    expect(profile.email).toBe("ada@example.test");
    expect(profile.name).toBe("Ada");
    expect(profile.avatarUrl).toBe("https://example.test/a.png");
  });

  it("passes a verified flag through when the provider sets it", async () => {
    stubFetch({
      body: { sub: "s", email: "a@b.c", email_verified: true, name: "A" },
    });

    expect((await (await google()).getUserInfo("t")).emailVerified).toBe(true);
  });
});

describe("C2C-SEC-6 AC6/AC7 — GitHub's hidden email", () => {
  it("AC6: falls back to /user/emails and takes the primary verified address", async () => {
    const calls = stubFetch(
      { body: { id: 4242, login: "ada", name: "Ada", email: null, avatar_url: "https://e/a.png" } },
      {
        body: [
          { email: "secondary@example.test", primary: false, verified: true },
          { email: "primary@example.test", primary: true, verified: true },
        ],
      },
    );

    const profile = await (await github()).getUserInfo("access-token");

    expect(calls[1].url).toBe("https://api.github.com/user/emails");
    expect(profile.email).toBe("primary@example.test");
    expect(profile.emailVerified).toBe(true);
    expect(profile.providerAccountId).toBe("4242");
  });

  it("AC7: rejects with a typed error when no verified address exists", async () => {
    stubFetch(
      { body: { id: 1, login: "ghost", name: null, email: null } },
      { body: [{ email: "unverified@example.test", primary: true, verified: false }] },
    );

    const error = await (await github())
      .getUserInfo("t")
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(await OAuthErrorClass());
    // Named, because SEC-7 maps it onto a specific message for the user.
    expect((error as OAuthError).reason).toBe("no_verified_email");
  });

  it("AC7: rejects when the address list is empty", async () => {
    stubFetch({ body: { id: 1, login: "ghost", email: null } }, { body: [] });

    await expect((await github()).getUserInfo("t")).rejects.toBeInstanceOf(
      await OAuthErrorClass(),
    );
  });

  it("ignores a verified address that is not primary when a primary one exists", async () => {
    stubFetch(
      { body: { id: 1, login: "ada", email: null } },
      {
        body: [
          { email: "verified-not-primary@example.test", primary: false, verified: true },
          { email: "primary@example.test", primary: true, verified: true },
        ],
      },
    );

    expect((await (await github()).getUserInfo("t")).email).toBe("primary@example.test");
  });

  it("skips the extra call when /user already returns an address", async () => {
    const calls = stubFetch({
      body: { id: 7, login: "ada", name: "Ada", email: "public@example.test" },
    });

    const profile = await (await github()).getUserInfo("t");

    expect(profile.email).toBe("public@example.test");
    expect(calls).toHaveLength(1);
  });
});

/** Small helper so the assertions above read as one line. */
function url(value: string): URL {
  return new URL(value);
}
