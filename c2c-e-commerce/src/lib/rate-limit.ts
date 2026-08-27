import type { NextRequest } from "next/server";

// ─── In-memory sliding-window rate limiter ────────────────────────────────────
// Guards the unauthenticated auth endpoints against brute-force and signup spam.
//
// Scope note: state lives in this process's memory. That is correct for the
// current deployment (a single long-running `next start` container on Railway),
// but it does NOT hold across horizontally scaled instances or on serverless
// platforms where each invocation may get a fresh process. If this app is ever
// scaled out, swap the Map for Redis — the exported API can stay the same.

type Timestamps = number[];

const buckets = new Map<string, Timestamps>();

/** Opportunistic sweep so keys from one-off IPs cannot grow the Map forever. */
const SWEEP_EVERY_N_CALLS = 500;
let callsSinceSweep = 0;

function sweep(now: number, windowMs: number): void {
  for (const [key, hits] of buckets) {
    const live = hits.filter((t) => now - t < windowMs);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
}

export type RateLimitOptions = {
  /** Max requests permitted inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the oldest hit ages out. Only meaningful when blocked. */
  retryAfterSeconds: number;
};

/**
 * Record a hit against `key` and report whether it is allowed.
 *
 * ```ts
 * const { allowed, retryAfterSeconds } = rateLimit(`login:${ip}`, LOGIN_LIMIT);
 * if (!allowed) return jsonError("Too many attempts", 429, { "Retry-After": ... });
 * ```
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions
): RateLimitResult {
  const now = Date.now();

  if (++callsSinceSweep >= SWEEP_EVERY_N_CALLS) {
    callsSinceSweep = 0;
    sweep(now, windowMs);
  }

  // Drop hits that have aged out of the window.
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    const oldest = hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  hits.push(now);
  buckets.set(key, hits);

  return { allowed: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

/** Clears all state. Exposed for tests. */
export function resetRateLimits(): void {
  buckets.clear();
  callsSinceSweep = 0;
}

// ─── Client IP ────────────────────────────────────────────────────────────────

/**
 * Best-effort client IP. `NextRequest.ip` was removed in Next 15, so we read the
 * proxy headers that Railway/Vercel set.
 *
 * These headers are client-controllable when the app is not behind a trusted
 * proxy, so this is a speed bump for casual abuse, not an identity guarantee.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

// ─── Shared policies ──────────────────────────────────────────────────────────

/** Password guessing: generous enough for a fat-fingered human, not for a script. */
export const LOGIN_RATE_LIMIT: RateLimitOptions = {
  limit: 10,
  windowMs: 15 * 60 * 1000,
};

/** Signup spam — the expensive part is bcrypt, so keep this tighter. */
export const REGISTER_RATE_LIMIT: RateLimitOptions = {
  limit: 10,
  windowMs: 60 * 60 * 1000,
};

/**
 * Generation endpoints (C2C-AI-5).
 *
 * Keyed on the user rather than the IP: the endpoint is authenticated, so the quota
 * belongs to the account, and sharing an office NAT should not mean sharing an AI budget.
 *
 * Groq's free tier is roughly 30 requests/minute across the whole deployment, and a seller
 * writing one listing needs a handful of attempts rather than hundreds.
 */
export const AI_RATE_LIMIT: RateLimitOptions = {
  limit: 10,
  windowMs: 60 * 60 * 1000,
};

/**
 * OAuth initiation, per IP (C2C-SEC-7).
 *
 * Each hit mints a transaction cookie and a redirect; cheap individually, but an
 * unbounded stream is a free way to burn CPU on HMAC signing.
 */
export const OAUTH_INITIATE_RATE_LIMIT: RateLimitOptions = {
  limit: 20,
  windowMs: 5 * 60 * 1000,
};

/**
 * OAuth callback, per IP.
 *
 * Tighter than initiation is tempting but wrong: a legitimate user hits the callback
 * once per sign-in, while an attacker guessing `state` gets one attempt per request
 * either way. This bounds the guessing rate without breaking a user who retries.
 */
export const OAUTH_CALLBACK_RATE_LIMIT: RateLimitOptions = {
  limit: 20,
  windowMs: 5 * 60 * 1000,
};
