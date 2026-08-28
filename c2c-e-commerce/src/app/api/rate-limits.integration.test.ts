/**
 * C2C-SEC-11 spec — the limiter applied to the routes this backlog added.
 *
 * The AI endpoint is the one that costs real money and real CPU per call, and it is
 * keyed on the **user id** rather than the IP: it is authenticated, so the quota belongs
 * to the account, and IP-keying would punish everyone behind one office NAT while
 * letting a single user rotate addresses.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AI_RATE_LIMIT, resetRateLimits } from "@/lib/rate-limit";
import { REFRESH_COOKIE } from "@/lib/refresh-cookies";
import { issueRefreshToken } from "@/lib/refresh-token";
import { authHeaderFor } from "@/test/auth";
import { resetDb } from "@/test/db";
import { makeUser } from "@/test/factories";

const llm = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/ai/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/llm")>();
  return {
    ...actual,
    getLlmProvider: () => ({
      model: "mock-llm-v1",
      generate: async () => {
        llm.calls += 1;
        return "A generated description.";
      },
    }),
  };
});

let originalEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  originalEnv = { ...process.env };
  process.env.OAUTH_PROVIDER = "mock";
  process.env.OAUTH_REDIRECT_BASE_URL = "http://localhost:3000";
  await resetDb();
  resetRateLimits();
  llm.calls = 0;
});

afterEach(() => {
  process.env = originalEnv;
});

const BODY = { title: "Vintage road bike", keywords: ["steel", "1980s"] };

async function generate(headers: Record<string, string>, ip = "203.0.113.1") {
  const { POST } = await import("./listings/generate-description/route");
  return POST(
    new NextRequest("http://localhost/api/listings/generate-description", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
      body: JSON.stringify(BODY),
    }),
  );
}

describe("C2C-SEC-11 AC1 — the AI budget", () => {
  it("blocks past the limit and makes no LLM call", async () => {
    const seller = await makeUser({ role: "seller" });
    const auth = authHeaderFor(seller);

    for (let i = 0; i < AI_RATE_LIMIT.limit; i += 1) {
      expect((await generate(auth)).status).toBe(200);
    }

    const callsBefore = llm.calls;
    const blocked = await generate(auth);

    expect(blocked.status).toBe(429);
    // The point of limiting this endpoint: the spend stops, not just the response.
    expect(llm.calls).toBe(callsBefore);
  });

  it("AC3: the blocked response carries all three headers", async () => {
    const seller = await makeUser({ role: "seller" });
    const auth = authHeaderFor(seller);

    for (let i = 0; i < AI_RATE_LIMIT.limit; i += 1) await generate(auth);
    const blocked = await generate(auth);

    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe(String(AI_RATE_LIMIT.limit));
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("AC2: one seller's exhaustion does not affect another", async () => {
    const a = await makeUser({ role: "seller" });
    const b = await makeUser({ role: "seller" });

    for (let i = 0; i < AI_RATE_LIMIT.limit; i += 1) await generate(authHeaderFor(a));
    expect((await generate(authHeaderFor(a))).status).toBe(429);

    // Same IP throughout: this passes only because the key is the user id.
    expect((await generate(authHeaderFor(b))).status).toBe(200);
  });

  it("keys on the user, not the address, so rotating IPs does not help", async () => {
    const seller = await makeUser({ role: "seller" });
    const auth = authHeaderFor(seller);

    for (let i = 0; i < AI_RATE_LIMIT.limit; i += 1) {
      await generate(auth, `198.51.100.${i + 1}`);
    }

    expect((await generate(auth, "198.51.100.200")).status).toBe(429);
  });

  it("AC7: resetRateLimits clears the state between cases", async () => {
    const seller = await makeUser({ role: "seller" });
    const auth = authHeaderFor(seller);

    for (let i = 0; i < AI_RATE_LIMIT.limit; i += 1) await generate(auth);
    expect((await generate(auth)).status).toBe(429);

    resetRateLimits();

    expect((await generate(auth)).status).toBe(200);
  });
});

describe("C2C-SEC-11 AC5 — the OAuth routes", () => {
  it("limits initiation per IP", async () => {
    const { GET } = await import("./auth/oauth/[provider]/route");
    const call = () =>
      GET(
        new NextRequest("http://localhost/api/auth/oauth/google", {
          headers: { "x-forwarded-for": "198.51.100.42" },
        }),
        { params: Promise.resolve({ provider: "google" }) },
      );

    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) statuses.push((await call()).status);

    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 302).length).toBeGreaterThan(0);
  });

  it("carries the headers on the blocked OAuth response too", async () => {
    const { GET } = await import("./auth/oauth/[provider]/route");
    const call = () =>
      GET(
        new NextRequest("http://localhost/api/auth/oauth/google", {
          headers: { "x-forwarded-for": "198.51.100.43" },
        }),
        { params: Promise.resolve({ provider: "google" }) },
      );

    let blocked: Response | null = null;
    for (let i = 0; i < 30 && !blocked; i += 1) {
      const response = await call();
      if (response.status === 429) blocked = response;
    }

    expect(blocked).not.toBeNull();
    expect(blocked!.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(blocked!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("C2C-SEC-11 AC6 — POST /api/auth/refresh", () => {
  async function refresh(token: string, ip: string) {
    const { POST } = await import("./auth/refresh/route");
    return POST(
      new NextRequest("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { cookie: `${REFRESH_COOKIE}=${token}`, "x-forwarded-for": ip },
      }),
    );
  }

  it("limits an unbounded stream from one address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      // Bogus tokens: the limiter must bite before the database is consulted 60 times.
      statuses.push((await refresh("not-a-real-token", "198.51.100.50")).status);
    }

    expect(statuses).toContain(429);
  });

  it("does not break a legitimate multi-tab refresh", async () => {
    // SEC-4's single-flight means a real client sends one refresh per lapse, but a few
    // tabs opening at once still produce a small burst. That must succeed.
    const user = await makeUser();
    const ip = "198.51.100.51";

    let token = (await issueRefreshToken(user.id)).token;

    for (let i = 0; i < 3; i += 1) {
      const response = await refresh(token, ip);
      expect(response.status).toBe(200);
      const setCookie = response.headers.getSetCookie?.() ?? [];
      const next = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
      token = next!.slice(REFRESH_COOKIE.length + 1).split(";")[0];
    }
  });
});
