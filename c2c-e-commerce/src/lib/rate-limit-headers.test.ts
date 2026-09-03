/**
 * C2C-SEC-11 AC3 — the headers a rate-limited response carries.
 *
 * `Retry-After` alone tells a client to wait but not how much budget it had. A client
 * that cannot see `X-RateLimit-Limit` has to discover the ceiling by hitting it, which
 * is exactly the traffic the limiter exists to stop.
 */
import { describe, expect, it } from "vitest";

import {
  AI_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  rateLimitHeaders,
  resetRateLimits,
  rateLimit,
} from "./rate-limit";

describe("C2C-SEC-11 AC3 — rateLimitHeaders", () => {
  it("reports the ceiling, what is left, and when to retry", () => {
    resetRateLimits();
    const result = rateLimit("headers:a", { limit: 10, windowMs: 60_000 });

    expect(rateLimitHeaders(result, { limit: 10, windowMs: 60_000 })).toEqual({
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "9",
    });
  });

  it("reports zero remaining and a Retry-After once blocked", () => {
    resetRateLimits();
    const options = { limit: 2, windowMs: 60_000 };
    rateLimit("headers:b", options);
    rateLimit("headers:b", options);
    const blocked = rateLimit("headers:b", options);

    const headers = rateLimitHeaders(blocked, options);

    expect(blocked.allowed).toBe(false);
    expect(headers["X-RateLimit-Limit"]).toBe("2");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("omits Retry-After while the caller is still within budget", () => {
    resetRateLimits();
    const result = rateLimit("headers:c", { limit: 5, windowMs: 60_000 });

    // A Retry-After on a successful response would tell a client to back off when it
    // has no reason to.
    expect(rateLimitHeaders(result, { limit: 5, windowMs: 60_000 })).not.toHaveProperty(
      "Retry-After",
    );
  });

  it("emits header values as strings, since headers carry no other type", () => {
    resetRateLimits();
    const result = rateLimit("headers:d", { limit: 3, windowMs: 60_000 });

    for (const value of Object.values(rateLimitHeaders(result, { limit: 3, windowMs: 60_000 }))) {
      expect(typeof value).toBe("string");
    }
  });

  it("never reports negative remaining", () => {
    resetRateLimits();
    const options = { limit: 1, windowMs: 60_000 };
    rateLimit("headers:e", options);

    for (let i = 0; i < 5; i += 1) {
      const result = rateLimit("headers:e", options);
      expect(Number(rateLimitHeaders(result, options)["X-RateLimit-Remaining"]))
        .toBeGreaterThanOrEqual(0);
    }
  });
});

describe("C2C-SEC-11 — the documented policies exist and are sane", () => {
  const policies = { LOGIN_RATE_LIMIT, AI_RATE_LIMIT };

  it("gives every policy a positive limit and window", () => {
    for (const [name, policy] of Object.entries(policies)) {
      expect(policy.limit, name).toBeGreaterThan(0);
      expect(policy.windowMs, name).toBeGreaterThan(0);
    }
  });

  it("keeps the AI budget hourly rather than per-minute", () => {
    // A per-minute window would let one seller burn the whole Groq free tier in an hour.
    expect(AI_RATE_LIMIT.windowMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});
