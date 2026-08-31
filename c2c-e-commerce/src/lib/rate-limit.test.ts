import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  rateLimit,
  resetRateLimits,
  LOGIN_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
} from "./rate-limit";

beforeEach(() => {
  resetRateLimits();
});

// ─── rateLimit ────────────────────────────────────────────────────────────────

describe("rateLimit", () => {
  const policy = { limit: 3, windowMs: 60_000 };

  it("allows requests up to the limit", () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("key", policy).allowed).toBe(true);
    }
  });

  it("blocks the request that exceeds the limit", () => {
    for (let i = 0; i < 3; i++) rateLimit("key", policy);

    const result = rateLimit("key", policy);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("counts down remaining", () => {
    expect(rateLimit("key", policy).remaining).toBe(2);
    expect(rateLimit("key", policy).remaining).toBe(1);
    expect(rateLimit("key", policy).remaining).toBe(0);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 3; i++) rateLimit("a", policy);

    expect(rateLimit("a", policy).allowed).toBe(false);
    expect(rateLimit("b", policy).allowed).toBe(true);
  });

  it("reports a positive retryAfterSeconds when blocked", () => {
    for (let i = 0; i < 3; i++) rateLimit("key", policy);

    const result = rateLimit("key", policy);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("does not block a blocked key forever — a further attempt still reports retry info", () => {
    for (let i = 0; i < 5; i++) rateLimit("key", policy);

    const result = rateLimit("key", policy);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});

// ─── Window expiry ────────────────────────────────────────────────────────────

describe("rateLimit window expiry", () => {
  const policy = { limit: 2, windowMs: 60_000 };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows again once the window has passed", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    expect(rateLimit("key", policy).allowed).toBe(true);
    expect(rateLimit("key", policy).allowed).toBe(true);
    expect(rateLimit("key", policy).allowed).toBe(false);

    // Just past the window — the earlier hits have aged out.
    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(rateLimit("key", policy).allowed).toBe(true);
  });

  it("slides rather than resetting wholesale", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    rateLimit("key", policy);

    // Second hit 30s later, so at T+61s only the first has expired.
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    rateLimit("key", policy);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(rateLimit("key", policy).allowed).toBe(true);
    // The 00:00:30 hit and the one just recorded still occupy the window.
    expect(rateLimit("key", policy).allowed).toBe(false);
  });
});

// Client-address resolution (trusted-proxy hops, X-Forwarded-For / X-Real-IP parsing) now
// lives in client-ip.test.ts, alongside `clientIdentity` and `rateLimitByIp`'s consumer of
// it.

// ─── Policies ─────────────────────────────────────────────────────────────────

describe("shared policies", () => {
  it("login allows a human retrying but not a script", () => {
    expect(LOGIN_RATE_LIMIT.limit).toBe(10);
    expect(LOGIN_RATE_LIMIT.windowMs).toBe(15 * 60 * 1000);
  });

  it("register is scoped to an hour", () => {
    expect(REGISTER_RATE_LIMIT.limit).toBe(10);
    expect(REGISTER_RATE_LIMIT.windowMs).toBe(60 * 60 * 1000);
  });
});

describe("sweep isolation", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The regression test for the 12x amplification. A flood against a short-window policy
  // used to prune long-window buckets against the *short* window, silently shortening
  // every other policy in the process.
  it("does not shorten another policy's window when a cheap policy triggers the sweep", () => {
    const HOURLY = { limit: 5, windowMs: 60 * 60 * 1000 };
    const SHORT = { limit: 10_000, windowMs: 5 * 60 * 1000 };

    // One hit against the long-window policy.
    const first = rateLimit("hourly:victim", HOURLY);
    expect(first.remaining).toBe(4);

    // Ten minutes later that hit is still live — it is well inside the hour — but it is
    // now older than the short policy's whole window, which is what makes it vulnerable.
    vi.advanceTimersByTime(10 * 60 * 1000);

    // A flood on the cheap policy. SWEEP_EVERY_N_CALLS is 500, so 600 guarantees at
    // least one sweep runs while the short window is the one being applied.
    for (let i = 0; i < 600; i += 1) {
      rateLimit(`short:${i}`, SHORT);
    }

    // The hourly bucket must still be holding its hit.
    const second = rateLimit("hourly:victim", HOURLY);
    expect(second.remaining).toBe(3);
  });

  it("still evicts a bucket once its own window has passed", () => {
    const POLICY = { limit: 3, windowMs: 60 * 1000 };

    rateLimit("minutely:someone", POLICY);
    vi.advanceTimersByTime(61 * 1000);

    // Past its own window, so the earlier hit no longer counts against the caller.
    expect(rateLimit("minutely:someone", POLICY).remaining).toBe(2);
  });
});
