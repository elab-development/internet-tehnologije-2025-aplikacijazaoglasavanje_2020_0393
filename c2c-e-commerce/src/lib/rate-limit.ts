import type { NextRequest } from "next/server";

import { clientIdentity } from "@/lib/client-ip";

// ─── In-memory sliding-window rate limiter ────────────────────────────────────
// Guards the unauthenticated auth endpoints against brute-force and signup spam.
//
// Scope note: state lives in this process's memory. That is correct for the
// current deployment (a single long-running `next start` container on Railway),
// but it does NOT hold across horizontally scaled instances or on serverless
// platforms where each invocation may get a fresh process. If this app is ever
// scaled out, swap the Map for Redis — the exported API can stay the same.

/**
 * One caller's hits against one policy, carrying the window they were recorded under.
 *
 * The window is stored per bucket rather than passed to `sweep`, because the sweep runs
 * on behalf of whichever policy happened to be the 500th caller. Filtering every bucket
 * against *that* policy's window is how a flood on a 5-minute limit used to prune the
 * 1-hour limits down to 5 minutes.
 */
type Bucket = {
  windowMs: number;
  hits: number[];
};

const buckets = new Map<string, Bucket>();

/** Opportunistic sweep so keys from one-off IPs cannot grow the Map forever. */
const SWEEP_EVERY_N_CALLS = 500;
let callsSinceSweep = 0;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    const live = bucket.hits.filter((t) => now - t < bucket.windowMs);
    if (live.length === 0) buckets.delete(key);
    else bucket.hits = live;
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
    sweep(now);
  }

  // Drop hits that have aged out of *this* policy's window.
  const hits = (buckets.get(key)?.hits ?? []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    buckets.set(key, { windowMs, hits });
    const oldest = hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  hits.push(now);
  buckets.set(key, { windowMs, hits });

  return { allowed: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

/**
 * The response headers describing a caller's standing against a policy.
 *
 * `Retry-After` appears only when the caller is actually blocked: sending it on a
 * successful response tells a client to back off when it has no reason to, and clients
 * that honour it will throttle themselves for nothing.
 *
 * Values are strings because a header carries no other type; returning numbers here
 * would work by coercion and then break the first time one is compared.
 */
export function rateLimitHeaders(
  result: RateLimitResult,
  { limit }: RateLimitOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
  };

  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfterSeconds);
  }

  return headers;
}

/**
 * Refresh rotation, per IP (C2C-SEC-11).
 *
 * Deliberately loose. SEC-4's single-flight means a real client sends one refresh per
 * lapse, but several tabs opening together still produce a small burst, and throttling
 * that would break the session-recovery path this is supposed to protect. The number
 * that matters is the ceiling on an unauthenticated flood, not the floor on a browser.
 */
export const REFRESH_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 5 * 60 * 1000,
};

/** Clears all state. Exposed for tests. */
export function resetRateLimits(): void {
  buckets.clear();
  callsSinceSweep = 0;
}

// ─── Client identity ────────────────────────────────────────────────────────────

/**
 * Apply an IP-keyed policy, or report that the caller's address is not knowable.
 *
 * `applied: false` means `TRUSTED_PROXY_HOPS` is 0 — no proxy is trusted, so there is no
 * address to key on. The limit is **skipped**, not applied to a shared fallback bucket:
 * one bucket for every caller would let a single abuser lock out the whole deployment,
 * which is a worse outcome than the limit this replaces. Account-keyed limits carry the
 * protection in that topology.
 */
export function rateLimitByIp(
  prefix: string,
  request: NextRequest,
  options: RateLimitOptions,
): { applied: false } | { applied: true; result: RateLimitResult } {
  const identity = clientIdentity(request);
  if (identity.kind === "untrusted") return { applied: false };

  return { applied: true, result: rateLimit(`${prefix}:ip:${identity.value}`, options) };
}

/** `rateLimit` under a name that reads symmetrically beside `rateLimitByIp`. */
export const rateLimitByKey = rateLimit;

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

/**
 * Completing an account link, per IP (C2C-SEC-8).
 *
 * This endpoint checks a password, so it is a credential-guessing surface like login
 * and gets the same treatment. Tighter than login's window because a legitimate user
 * completes a link once.
 */
export const LINK_RATE_LIMIT: RateLimitOptions = {
  limit: 10,
  windowMs: 15 * 60 * 1000,
};

/**
 * Uploads are expensive: a 5 MB decode and re-encode each. Looser than login, far tighter
 * than a read endpoint.
 */
export const IMAGE_UPLOAD_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 60 * 60 * 1000,
};
