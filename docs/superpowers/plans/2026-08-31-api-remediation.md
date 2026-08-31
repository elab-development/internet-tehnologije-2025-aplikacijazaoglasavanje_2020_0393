# API Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 33 findings from the API review of `develop` @ `f0c5164`, closing five Critical defects — a spoofable rate-limit key, a sweep that truncates other policies' windows, an undeletable listing, unbounded money, and an unbounded upload — without regressing the 1,526 tests that already pass.

**Architecture:** Work proceeds in seven groups ordered by subsystem, not by severity, because the findings cluster by file: `rate-limit.ts` carries two Criticals and a Low, `images/route.ts` carries a Critical, a High and a Medium. Opening each file once is cheaper and safer than three times. Four of the five Criticals still land in the first three groups. Two new pure modules are extracted (`client-ip.ts`, `image-pipeline.ts`) so the logic that matters most can be unit-tested without a container.

**Tech Stack:** Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5 (strict), Drizzle ORM 0.45, PostgreSQL 16 (pgvector/pg16), Zod 4, Vitest 4 with three projects (`unit`, `integration`, `component`), bcrypt, sharp.

**Spec:** `docs/superpowers/specs/2026-08-31-api-remediation-design.md`

## Global Constraints

- **Never point any command at `DATABASE_URL` as configured.** It is the developer's own database and these migrations are destructive to it. The `integration` test project starts and manages its own throwaway Testcontainers instance; that is the only database any task may touch.
- **A migration without an entry in `drizzle/meta/_journal.json` silently never runs.** The migrator applies migrations from the journal, not by globbing `drizzle/*.sql`. Every new `.sql` file gets a matching journal entry in the same commit.
- **Drizzle wraps driver errors in `DrizzleQueryError`.** Postgres `code` and `constraint` live on `.cause`, not on the caught error. Use `isUniqueViolation(err, indexName)` from `src/db/pg-errors.ts`; never hand-roll the field reads.
- **`TRUSTED_PROXY_HOPS` defaults to `0`, which means no proxy is trusted.** At `0`, IP-keyed limits are **skipped**, never collapsed into one shared bucket — a shared bucket is worse than no limit, because one abuser would lock out every user.
- **The `X-Forwarded-For` client index is `entries[entries.length - hops]`.** Not `length - 1 - hops`. With one proxy setting `XFF: "client"`, that index is `-1`.
- **No `any`, no `as unknown as`, no non-null assertions** in new code. The reviewed API surface currently contains none; keep it that way. The one existing `as unknown as` (`auth.ts:88`) is removed by Task 6.
- **Run the full suite with no background flag and no polling.** Wait inside the call, timeout `900000` ms. Backgrounding `npm test` has stalled this project's agents five times.
- **Every security guard gets the deliberate-break check.** Remove the guard, run the *named* test, confirm it fails, restore. A guard whose test still passes without it is not a guard, and this project has already shipped several.
- **Test helpers are never invented.** Every seeding helper a task's test uses (`seedListing`, `seedPendingOrder`, `seedAdmin`, `authed`, and the rest) comes from `src/test/harness/factories.ts` or from the test file neighbouring the one you are writing. Read that neighbour first and reuse its helpers and its style; if a helper genuinely does not exist, add it to `factories.ts` where the next task can find it, rather than defining a private one inline.
- **Commit after every task.** Conventional-commit prefixes, matching the existing log (`feat(sec-11):`, `fix(listings):`, `docs(api):`).

## Deliberate Deviations

Five places where this plan knowingly departs from the spec or the review it came from. Each is a ruling, not an oversight.

1. **The sweep-isolation test is a unit test, not an integration test.** The spec lists it under §10.2. `rate-limit.ts` holds its state in a plain in-process `Map`, so a unit test with fake timers is deterministic, runs in milliseconds, and can assert the exact remaining count. An integration test would need a container to prove nothing about the database.
2. **`rateLimitByIp` is a new exported helper rather than eight open-coded call sites.** The spec describes the behaviour per route; eight copies of a three-branch conditional is exactly the duplication the review criticised elsewhere in this codebase.
3. **`clientIdentityFrom` (pure) is separated from `clientIdentity` (reads a `NextRequest`).** The spec names only the latter. The split follows `listing-visibility.ts`, which is pure for the same reason: it is a security boundary and needs exhaustive testing without constructing requests.
4. **`priceField` returns a `string`, not a `number`.** The spec says "handed to Postgres as a string" but does not pin the Zod output type. Returning a string is what actually prevents the float round-trip; a `number` output would reintroduce it one line later. Consumers are `CreateListingSchema` and `UpdateListingSchema`, and the `price` column is `numeric(10,2)`, which Drizzle already types as `string`.
5. **Task 12 and Task 22 are batched multi-fix tasks.** Each bundles three or four one-line fixes that share no logic but do share a review surface. Splitting them would mean eight dispatches for eleven lines of change.

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `src/lib/client-ip.ts` | Hop-counted client identity. Pure `clientIdentityFrom` + a `NextRequest` reader. The security boundary for every IP-keyed limit. |
| `src/lib/client-ip.test.ts` | Unit tests for the hop arithmetic, including the spoofed-prefix case. |
| `src/lib/image-pipeline.ts` | `processUploadedImage(bytes)` — decode, rotate, resize, re-encode to WebP. Extracted from the route so it is testable on bytes. |
| `src/lib/image-pipeline.test.ts` | Unit tests over real fixture bytes. |
| `drizzle/0019_users_email_lower.sql` | Lowercase existing emails, refuse on collision, add `users_email_lower_idx`. |
| `drizzle/0020_listing_images_sort_order.sql` | Renumber duplicate sort orders, add `listing_images_listing_sort_idx`. |
| `eslint.config.repo.mjs` *(merged into `eslint.config.mjs`)* | Repo-specific rules for the error-logging convention and raw `<img>`. |

**Modified files, by the task that owns them**

| File | Task | Change |
|---|---|---|
| `src/lib/rate-limit.ts` | 2, 3 | Per-bucket `windowMs`; `getClientIp` removed; `rateLimitByIp` added |
| `src/lib/rate-limit.test.ts` | 2 | Sweep-isolation regression test |
| `src/app/api/rate-limits.integration.test.ts` | 3 | Stops using header rotation as a reset; asserts rotation no longer works |
| `src/app/api/auth/login/route.ts` | 3, 12 | Identity + email key + full headers; log stops carrying the email |
| `src/app/api/auth/register/route.ts` | 3, 5 | Identity + email key + full headers; 409 on unique violation |
| `src/app/api/auth/refresh/route.ts` | 3 | Identity |
| `src/app/api/auth/oauth/[provider]/route.ts` | 3 | Identity |
| `src/app/api/auth/oauth/[provider]/callback/route.ts` | 3, 10 | Identity; account creation in one transaction |
| `src/app/api/auth/oauth/link/route.ts` | 3 | Identity |
| `src/app/api/listings/[id]/images/route.ts` | 3, 7, 9 | Identity → `user:<sub>`; pipeline extracted; 411 gate, lock, ordering |
| `src/lib/validation.ts` | 4, 5, 11 | `priceField`; email lowercasing; `currentPassword` |
| `src/lib/auth.ts` | 6 | `verifyToken` parses its payload |
| `src/lib/params.ts` | 6 | `parseBoundedInt` added |
| `src/lib/listings-query.ts` | 6, 17 | Wildcard escaping, `parseBoundedInt`; `id` tiebreaker |
| `src/db/listing-images.ts` | 9 | `nextSortOrder` moves inside a transaction |
| `src/app/api/users/[id]/route.ts` | 11, 18 | Password change; `PUT` → `PATCH` |
| `src/app/api/listings/[id]/route.ts` | 13, 18 | Soft-delete; `PUT` → `PATCH` |
| `src/app/api/listings/[id]/similar/route.ts` | 14, 6 | Visibility check; `parseBoundedInt` |
| `src/app/api/orders/[id]/route.ts` | 15, 19 | Expiry guard; 400 → 409 |
| `src/db/orders.ts` | 15 | `releaseUnheldListings` releases from `sold` |
| `src/app/api/categories/[id]/route.ts` | 16, 18 | Guards inside the transaction; `PUT` → `PATCH` |
| `src/app/api/orders/route.ts`, `orders/seller/route.ts`, `users/route.ts` | 17 | Admin pagination |
| `c2c-e-commerce/next.config.ts` | 20 | `headers()` block |
| `docker-compose.yml` | 20 | `:?` on the password; drop the published port |
| `docs/security/threat-model.md`, `docs/security/rbac-matrix.md` | 21 | Corrections |
| `src/test/threat-model.test.ts` | 21 | Pins the corrected claims |
| Frontend call sites (`ListingForm.tsx`, order pages, settings) | 11, 18 | `api.put` → `api.patch`; `currentPassword` field |

---

## Task 1: Hop-counted client identity

**Files:**
- Create: `c2c-e-commerce/src/lib/client-ip.ts`
- Create: `c2c-e-commerce/src/lib/client-ip.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ClientIdentity = { kind: "ip"; value: string } | { kind: "untrusted" }`
  - `trustedProxyHops(raw: string | undefined): number`
  - `clientIdentityFrom(forwardedFor: string | null, realIp: string | null, hops: number): ClientIdentity`
  - `clientIdentity(request: NextRequest): ClientIdentity`

Tasks 2 and 3 consume all four.

- [ ] **Step 1: Write the failing test**

Create `c2c-e-commerce/src/lib/client-ip.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  clientIdentityFrom,
  trustedProxyHops,
  type ClientIdentity,
} from "@/lib/client-ip";

// The whole point of this module is that the client's own header cannot decide who the
// client is. Each case below is a row of the topology table in §3.1 of the spec.
describe("clientIdentityFrom", () => {
  const ip = (value: string): ClientIdentity => ({ kind: "ip", value });
  const untrusted: ClientIdentity = { kind: "untrusted" };

  it("reads the client from a single-proxy chain", () => {
    // client -> P1 -> app. P1 appends the address it saw, so the list is just the client.
    expect(clientIdentityFrom("203.0.113.7", null, 1)).toEqual(ip("203.0.113.7"));
  });

  it("reads the client from a two-proxy chain", () => {
    // client -> P1 -> P2 -> app. P1 appended the client, P2 appended P1.
    expect(clientIdentityFrom("203.0.113.7, 10.0.0.1", null, 2)).toEqual(
      ip("203.0.113.7"),
    );
  });

  it("ignores a prefix the client wrote themselves", () => {
    // The attacker sent `X-Forwarded-For: 1.2.3.4`; the one real proxy appended their
    // actual address. Counting from the right is what discards the forgery.
    expect(clientIdentityFrom("1.2.3.4, 203.0.113.7", null, 1)).toEqual(
      ip("203.0.113.7"),
    );
  });

  it("ignores an arbitrarily long forged prefix", () => {
    const forged = Array.from({ length: 50 }, (_, i) => `1.2.3.${i}`).join(", ");
    expect(clientIdentityFrom(`${forged}, 203.0.113.7`, null, 1)).toEqual(
      ip("203.0.113.7"),
    );
  });

  it("trusts nothing when no proxy is configured", () => {
    // hops = 0 is the default. There is no proxy, so the header is pure user input.
    expect(clientIdentityFrom("203.0.113.7", null, 0)).toEqual(untrusted);
    expect(clientIdentityFrom("203.0.113.7", "203.0.113.7", 0)).toEqual(untrusted);
  });

  it("refuses to guess when the header is shorter than configured", () => {
    // Two proxies configured, one entry present: either the header was stripped or the
    // hop count is wrong. Both are misconfiguration, and neither is a client address.
    expect(clientIdentityFrom("203.0.113.7", null, 2)).toEqual(untrusted);
    expect(clientIdentityFrom(null, null, 1)).toEqual(untrusted);
  });

  it("falls back to x-real-ip only when a proxy is trusted", () => {
    expect(clientIdentityFrom(null, "203.0.113.7", 1)).toEqual(ip("203.0.113.7"));
    expect(clientIdentityFrom(null, "203.0.113.7", 0)).toEqual(untrusted);
  });

  it("tolerates whitespace and empty entries", () => {
    expect(clientIdentityFrom("  1.2.3.4 ,  , 203.0.113.7  ", null, 1)).toEqual(
      ip("203.0.113.7"),
    );
  });

  it("treats a whitespace-only header as absent", () => {
    expect(clientIdentityFrom("   ", null, 1)).toEqual(untrusted);
  });
});

describe("trustedProxyHops", () => {
  it("defaults to zero when unset", () => {
    expect(trustedProxyHops(undefined)).toBe(0);
  });

  it("parses a positive integer", () => {
    expect(trustedProxyHops("1")).toBe(1);
    expect(trustedProxyHops(" 2 ")).toBe(2);
  });

  // Fails closed on every malformed value: a typo must not silently enable trust.
  it.each(["", "-1", "1.5", "one", "1abc", "0x1"])(
    "falls back to zero for %o",
    (raw) => {
      expect(trustedProxyHops(raw)).toBe(0);
    },
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/client-ip.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/client-ip"`.

- [ ] **Step 3: Write the implementation**

Create `c2c-e-commerce/src/lib/client-ip.ts`:

```ts
import type { NextRequest } from "next/server";

// ─── Who is calling ───────────────────────────────────────────────────────────
//
// `X-Forwarded-For` is a list that grows by one entry per proxy, and each proxy appends
// *the address it was talking to*. So the entry a proxy writes is trustworthy; every
// entry to the left of it was written by something further out, and the left-most entry
// was written by the client. Reading the left-most entry — which is what this app did
// until now — asks the attacker who the attacker is.
//
// With `hops` trusted proxies between the client and this process, the client's address
// is at `entries[entries.length - hops]`. Not `length - 1 - hops`: a single proxy sets
// the header to just `"client"`, and that index is -1.
//
// This is a security boundary, so the arithmetic lives in a pure function that can be
// exhaustively tested without constructing a request — the same reason
// `listing-visibility.ts` is shaped this way.

export type ClientIdentity =
  | { kind: "ip"; value: string }
  /** The caller's address is not knowable. Callers must not invent a key from this. */
  | { kind: "untrusted" };

/**
 * How many proxies sit between the client and this process.
 *
 * Defaults to 0 — no proxy trusted — and falls back to 0 for every malformed value.
 * Failing closed matters more than being helpful here: a typo that silently enabled
 * trust would restore the exact bypass this module exists to close.
 */
export function trustedProxyHops(raw: string | undefined): number {
  if (raw === undefined) return 0;

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 0;

  const hops = Number(trimmed);
  return Number.isSafeInteger(hops) ? hops : 0;
}

/**
 * Resolve the caller's address from proxy headers, or report that it is unknowable.
 *
 * @param forwardedFor the raw `X-Forwarded-For` header, or null
 * @param realIp       the raw `X-Real-IP` header, or null
 * @param hops         trusted proxies in front of this process
 */
export function clientIdentityFrom(
  forwardedFor: string | null,
  realIp: string | null,
  hops: number,
): ClientIdentity {
  // No trusted proxy means no header is evidence of anything.
  if (hops < 1) return { kind: "untrusted" };

  const entries = (forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length > 0) {
    const index = entries.length - hops;
    // A negative index means the header carries fewer entries than there are trusted
    // proxies — the header was stripped, or the hop count is wrong. Either way there is
    // no client address in it, and guessing would hand the attacker the left-most entry
    // all over again.
    return index >= 0
      ? { kind: "ip", value: entries[index] }
      : { kind: "untrusted" };
  }

  // Only reached when the trusted proxy sets `X-Real-IP` instead. It is trusted on the
  // same basis and for the same reason: a proxy we have been told to believe wrote it.
  const real = realIp?.trim();
  return real ? { kind: "ip", value: real } : { kind: "untrusted" };
}

/** `clientIdentityFrom`, reading the headers and the environment for you. */
export function clientIdentity(request: NextRequest): ClientIdentity {
  return clientIdentityFrom(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
    trustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/client-ip.test.ts
```

Expected: PASS, 18 tests.

- [ ] **Step 5: Deliberate break**

Temporarily change the index in `clientIdentityFrom` from `entries.length - hops` to `0` — the old left-most behaviour. Re-run the test.

Expected: FAIL on **"ignores a prefix the client wrote themselves"** and **"ignores an arbitrarily long forged prefix"**, by name. If those two still pass, the test does not test the bypass and must be fixed before continuing. Restore the line.

- [ ] **Step 6: Commit**

```bash
git add c2c-e-commerce/src/lib/client-ip.ts c2c-e-commerce/src/lib/client-ip.test.ts
git commit -m "feat(api): hop-counted client identity that ignores a forged XFF prefix"
```

---

## Task 2: Per-bucket window in the rate limiter

**Files:**
- Modify: `c2c-e-commerce/src/lib/rate-limit.ts:14-26` (the `buckets` Map and `sweep`), `:50-78` (`rateLimit`)
- Modify: `c2c-e-commerce/src/lib/rate-limit.test.ts` (add one describe block)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no signature changes. `rateLimit`, `rateLimitHeaders`, `resetRateLimits`, `RateLimitOptions`, `RateLimitResult` and every policy constant keep their current exported shapes. Only the internal bucket representation changes.

The bug: `sweep(now, windowMs)` filters **every** bucket against the *calling* policy's window, and fires every 500 calls globally. 500 cheap hits on the 5-minute refresh policy prune the 1-hour buckets down to 5 minutes — a 12× amplification of exactly the floods those limits exist to stop.

- [ ] **Step 1: Write the failing test**

Append to `c2c-e-commerce/src/lib/rate-limit.test.ts`:

```ts
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
```

Make sure the file's imports include `resetRateLimits` and `vi`, `beforeEach`, `afterEach` from `vitest`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/rate-limit.test.ts
```

Expected: FAIL on **"does not shorten another policy's window when a cheap policy triggers the sweep"** with `expected 4 to be 3` — the hourly bucket was swept away, so the second call looks like a first call.

- [ ] **Step 3: Write the implementation**

In `c2c-e-commerce/src/lib/rate-limit.ts`, replace the bucket type, the Map and `sweep`:

```ts
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

/** Opportunistic sweep so keys from one-off callers cannot grow the Map forever. */
const SWEEP_EVERY_N_CALLS = 500;
let callsSinceSweep = 0;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    const live = bucket.hits.filter((t) => now - t < bucket.windowMs);
    if (live.length === 0) buckets.delete(key);
    else bucket.hits = live;
  }
}
```

Then rewrite the body of `rateLimit` (keeping its signature and doc comment):

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/rate-limit.test.ts
```

Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Deliberate break**

Temporarily change `sweep(now)` back to taking the calling window — `function sweep(now: number, windowMs: number)` filtering on that parameter, called as `sweep(now, windowMs)`. Re-run.

Expected: FAIL on **"does not shorten another policy's window when a cheap policy triggers the sweep"**, by name. Restore.

- [ ] **Step 6: Commit**

```bash
git add c2c-e-commerce/src/lib/rate-limit.ts c2c-e-commerce/src/lib/rate-limit.test.ts
git commit -m "fix(sec): sweep each rate-limit bucket against its own window"
```

---

## Task 3: Wire client identity into every rate-limited route

**Files:**
- Modify: `c2c-e-commerce/src/lib/rate-limit.ts` — delete `getClientIp` (`:135-143`), add `rateLimitByIp`
- Modify: `c2c-e-commerce/src/app/api/auth/login/route.ts:7, :82-90, :123`
- Modify: `c2c-e-commerce/src/app/api/auth/register/route.ts:7, :92-100, :137`
- Modify: `c2c-e-commerce/src/app/api/auth/refresh/route.ts:10, :65, :85`
- Modify: `c2c-e-commerce/src/app/api/auth/oauth/[provider]/route.ts:12, :53`
- Modify: `c2c-e-commerce/src/app/api/auth/oauth/[provider]/callback/route.ts:23, :84, :273`
- Modify: `c2c-e-commerce/src/app/api/auth/oauth/link/route.ts:15, :53, :119`
- Modify: `c2c-e-commerce/src/app/api/listings/[id]/images/route.ts:21, :70`
- Modify: `c2c-e-commerce/src/app/api/rate-limits.integration.test.ts`

**Interfaces:**
- Consumes: `clientIdentity`, `ClientIdentity` from Task 1.
- Produces:
  - `rateLimitByIp(prefix: string, request: NextRequest, options: RateLimitOptions): { applied: false } | { applied: true; result: RateLimitResult }`
  - `rateLimitByKey(key: string, options: RateLimitOptions): RateLimitResult` — a named re-export of `rateLimit` for account-keyed limits, so call sites read symmetrically.
  - `getClientIp` **no longer exists.** Any remaining import is a compile error, which is the point.

Note the audit-log call sites (`login:123`, `register:137`, `refresh:85`, `callback:273`, `link:119`) pass `ip:` into a record. They take `clientIdentity(request)` and store `identity.kind === "ip" ? identity.value : null`, because recording an unverifiable address as though it were fact is what made the old header trustworthy-looking in the first place.

- [ ] **Step 1: Write the failing test**

Rewrite `c2c-e-commerce/src/app/api/rate-limits.integration.test.ts`'s bypass-dependent section. The file currently rotates `X-Forwarded-For` at line 57 to obtain a fresh bucket; that technique is the vulnerability. Replace the helper and add the assertion that it no longer works:

```ts
// This suite used to get a fresh bucket by rotating `X-Forwarded-For`. That worked
// because the limiter read the left-most entry — the one the caller writes — which was
// the Critical this task closes. Isolation now comes from resetting the limiter
// directly, and the old technique has become a test of its own.
beforeEach(() => {
  resetRateLimits();
});

describe("X-Forwarded-For is no longer a fresh-bucket button", () => {
  const ENDPOINT = "/api/auth/login";
  const CREDENTIALS = { email: "nobody@example.test", password: "wrong-password-1" };

  it("does not grant a new budget when the caller rotates the header", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";

    // Exhaust the per-IP budget from one apparent client. The trusted proxy appends the
    // real address, so the header below is what a proxy would produce.
    const asClient = (forged: string) => ({
      "x-forwarded-for": `${forged}, 203.0.113.9`,
      "content-type": "application/json",
    });

    let last = 0;
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit + 1; i += 1) {
      const response = await POST(
        new NextRequest(`http://test${ENDPOINT}`, {
          method: "POST",
          headers: asClient(`1.2.3.${i}`),
          body: JSON.stringify(CREDENTIALS),
        }),
      );
      last = response.status;
    }

    // Every request rotated the forged prefix; every request still landed in the same
    // bucket, because the address that counts is the one the proxy wrote.
    expect(last).toBe(429);
  });

  it("skips the IP limit entirely when no proxy is trusted", async () => {
    process.env.TRUSTED_PROXY_HOPS = "0";

    let last = 0;
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit + 1; i += 1) {
      const response = await POST(
        new NextRequest(`http://test${ENDPOINT}`, {
          method: "POST",
          headers: { "x-forwarded-for": "1.2.3.4", "content-type": "application/json" },
          // A different email each time, so the per-account key (Step 3) is not what
          // blocks here — this asserts the *IP* key is absent, nothing more.
          body: JSON.stringify({ ...CREDENTIALS, email: `nobody${i}@example.test` }),
        }),
      );
      last = response.status;
    }

    expect(last).toBe(401);
  });
});

describe("per-account login limit", () => {
  it("blocks a password-guessing run even when the address is unknowable", async () => {
    process.env.TRUSTED_PROXY_HOPS = "0";

    const victim = "victim@example.test";
    let last = 0;
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit + 1; i += 1) {
      const response = await POST(
        new NextRequest(`http://test/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: victim, password: `guess-${i}` }),
        }),
      );
      last = response.status;
    }

    expect(last).toBe(429);
  });

  it("shares one bucket across case variants of the same address", async () => {
    process.env.TRUSTED_PROXY_HOPS = "0";

    let last = 0;
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit + 1; i += 1) {
      const email = i % 2 === 0 ? "Victim@Example.test" : "victim@example.test";
      const response = await POST(
        new NextRequest(`http://test/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: `guess-${i}` }),
        }),
      );
      last = response.status;
    }

    expect(last).toBe(429);
  });
});
```

Restore `process.env.TRUSTED_PROXY_HOPS` to its prior value in an `afterEach`, so one test cannot leak into another.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project integration src/app/api/rate-limits.integration.test.ts
```

Expected: FAIL — the rotation test returns 401 rather than 429 (rotation still works), and the per-account tests return 401 (no account key exists yet).

- [ ] **Step 3: Write the implementation**

In `c2c-e-commerce/src/lib/rate-limit.ts`, delete `getClientIp` entirely and add:

```ts
import { clientIdentity } from "@/lib/client-ip";

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
```

In `login/route.ts`, replace the import at `:7` and the limit block at `:82-90`:

```ts
import {
  rateLimitByIp,
  rateLimitByKey,
  rateLimitHeaders,
  LOGIN_RATE_LIMIT,
} from "@/lib/rate-limit";
import { clientIdentity } from "@/lib/client-ip";
```

```ts
    const byIp = rateLimitByIp("login", request, LOGIN_RATE_LIMIT);
    if (byIp.applied && !byIp.result.allowed) {
      return jsonError(
        "Too many login attempts. Please try again later.",
        429,
        rateLimitHeaders(byIp.result, LOGIN_RATE_LIMIT),
      );
    }
```

Then, immediately after the body parses successfully (after the existing `if (!parsed.ok) return jsonError(parsed.error, 400);` at `:94`), add the account key:

```ts
    // The key that survives IP rotation, and the only one that applies at all when no
    // proxy is trusted. Normalised the same way the column is, so `A@x.com` and
    // `a@x.com` cannot each get their own budget against one account.
    const byAccount = rateLimitByKey(
      `login:email:${parsed.data.email.trim().toLowerCase()}`,
      LOGIN_RATE_LIMIT,
    );
    if (!byAccount.allowed) {
      return jsonError(
        "Too many login attempts. Please try again later.",
        429,
        rateLimitHeaders(byAccount, LOGIN_RATE_LIMIT),
      );
    }
```

Note this also fixes the Low finding that login sent a bare `Retry-After`: both branches now use `rateLimitHeaders`, which emits the full trio.

Apply the identical shape to `register/route.ts` with `REGISTER_RATE_LIMIT` and the prefix `register`, keying on `parsed.data.email`.

For the five remaining routes the change is mechanical — the IP block only:

| File | Line | Old | New |
|---|---|---|---|
| `refresh/route.ts` | 65 | `rateLimit(\`refresh:${getClientIp(request)}\`, REFRESH_RATE_LIMIT)` | `rateLimitByIp("refresh", request, REFRESH_RATE_LIMIT)` |
| `oauth/[provider]/route.ts` | 53 | `rateLimit(\`oauth-initiate:${getClientIp(request)}\`, ...)` | `rateLimitByIp("oauth-initiate", request, ...)` |
| `oauth/[provider]/callback/route.ts` | 84 | `rateLimit(\`oauth-callback:${getClientIp(request)}\`, ...)` | `rateLimitByIp("oauth-callback", request, ...)` |
| `oauth/link/route.ts` | 53 | `rateLimit(\`oauth-link:${getClientIp(request)}\`, LINK_RATE_LIMIT)` | `rateLimitByIp("oauth-link", request, LINK_RATE_LIMIT)` |

Each becomes:

```ts
    const byIp = rateLimitByIp("<prefix>", request, <POLICY>);
    if (byIp.applied && !byIp.result.allowed) {
      return jsonError("<the route's existing message>", 429,
        rateLimitHeaders(byIp.result, <POLICY>));
    }
```

`listings/[id]/images/route.ts:70` is the exception: the caller is already authenticated there, so it keys on the subject instead of the address, per §3.3 of the spec.

```ts
    const limit = rateLimitByKey(`images:user:${payload.sub}`, IMAGE_UPLOAD_RATE_LIMIT);
    if (!limit.allowed) {
      return jsonError("Too many image uploads. Please try again later.", 429,
        rateLimitHeaders(limit, IMAGE_UPLOAD_RATE_LIMIT));
    }
```

Finally, the five audit-log sites. Each currently reads `ip: getClientIp(request)`. Replace with:

```ts
    const identity = clientIdentity(request);
    // ...
      ip: identity.kind === "ip" ? identity.value : null,
```

The `ip` column is already nullable (`refresh-token.ts:52` records `ip: ctx.ip ?? null`).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx tsc --noEmit
cd c2c-e-commerce && npx vitest run --project integration src/app/api/rate-limits.integration.test.ts
```

Expected: `tsc` clean — and if any file still imports `getClientIp`, `tsc` fails, which is the intended tripwire. Then the integration file passes.

- [ ] **Step 5: Confirm no call site was missed**

```bash
cd c2c-e-commerce && grep -rn "getClientIp" src/ || echo "no remaining references"
```

Expected: `no remaining references`.

- [ ] **Step 6: Run the full suite**

```bash
cd c2c-e-commerce && npm test
```

No background flag, no polling — wait inside the call, timeout 900000 ms. Expected: all green. Any other test that relied on header rotation for isolation surfaces here and is fixed the same way (`resetRateLimits()` in a `beforeEach`).

- [ ] **Step 7: Commit**

```bash
git add c2c-e-commerce/src
git commit -m "fix(sec): key rate limits on a trusted address and on the account

Closes the header bypass: rotating X-Forwarded-For no longer buys a fresh
budget, and sending a victim's address in failed logins no longer locks
that victim out. Where no proxy is trusted the IP limit is skipped rather
than collapsed into one shared bucket, and the account key carries the
protection instead."
```

---

## Task 4: Money validated as a decimal string

**Files:**
- Modify: `c2c-e-commerce/src/lib/validation.ts:66-77` (`priceField`)
- Modify: `c2c-e-commerce/src/lib/validation.test.ts` (add one describe block)

**Interfaces:**
- Consumes: nothing.
- Produces: `priceField` now outputs `string` (canonical `"1234.56"`), not `number`. Consumers `CreateListingSchema.price` (`:140`) and `UpdateListingSchema.price` (`:182`) change output type accordingly. The `listings.price` column is `numeric(10,2)`, which Drizzle already types as `string`, so route code that previously did `price: String(parsed.data.price)` — or relied on coercion — simplifies to `price: parsed.data.price`.

`parseFloat` is wrong three ways at once: `parseFloat("1e400")` is `Infinity`, which passes both existing checks and reaches a `numeric(10,2)` column as the string `"Infinity"` — PostgreSQL 14+ accepts it. `1e9` overflows the column into a 500. And `19.999` is silently rounded to `20.00` without telling the seller their price changed.

- [ ] **Step 1: Write the failing test**

Append to `c2c-e-commerce/src/lib/validation.test.ts`:

```ts
describe("priceField", () => {
  // Exercised through the schema that uses it, because that is how every route sees it.
  const parse = (price: unknown) =>
    CreateListingSchema.safeParse({
      title: "A bicycle",
      description: "A well-kept bicycle",
      price,
      categoryId: 1,
    });

  it("accepts a plain decimal and keeps it exact", () => {
    const result = parse("1234.56");
    expect(result.success).toBe(true);
    // A string, not a number: the value must never round-trip through a float on its way
    // to a numeric(10,2) column.
    expect(result.success && result.data.price).toBe("1234.56");
  });

  it("accepts an integer and canonicalises it", () => {
    const result = parse(1200);
    expect(result.success && result.data.price).toBe("1200.00");
  });

  it("accepts one decimal place and pads it", () => {
    expect(parse("19.5").success && parse("19.5").data.price).toBe("19.50");
  });

  it("accepts zero", () => {
    expect(parse("0").success).toBe(true);
  });

  // The Critical. "1e400" is Infinity, which the old parseFloat guard let through to a
  // numeric column that accepts it.
  it.each(["1e400", "Infinity", "-Infinity", "NaN"])("rejects %o", (price) => {
    expect(parse(price).success).toBe(false);
  });

  it("rejects a value above what numeric(10,2) can hold", () => {
    // 10 digits total, 2 after the point, so 99999999.99 is the ceiling. The old code let
    // this reach Postgres and turned an out-of-range price into a 500.
    const result = parse("100000000.00");
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toMatch(/too large/i);
  });

  it("accepts exactly the ceiling", () => {
    expect(parse("99999999.99").success).toBe(true);
  });

  // Silent rounding is a correctness bug with a human cost: the seller typed one price
  // and the marketplace charged another, with no complaint anywhere.
  it("rejects more than two decimal places rather than rounding", () => {
    const result = parse("19.999");
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toMatch(
      /at most 2 decimal places/i,
    );
  });

  it("rejects negative prices", () => {
    expect(parse("-0.01").success).toBe(false);
    expect(parse(-5).success).toBe(false);
  });

  it.each(["", "   ", "abc", "12.34.56", "1,234.56", "0x10", "12e2"])(
    "rejects the malformed value %o",
    (price) => {
      expect(parse(price).success).toBe(false);
    },
  );
});
```

Ensure `CreateListingSchema` is imported in the test file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/validation.test.ts
```

Expected: FAIL — `"1e400"`, `"19.999"` and `"100000000.00"` all parse successfully, and `data.price` is a number rather than a string.

- [ ] **Step 3: Write the implementation**

Replace `priceField` in `c2c-e-commerce/src/lib/validation.ts`:

```ts
// ─── Price transformer (shared) ───────────────────────────────────────────────
//
// Money is validated as a decimal *string* and handed to Postgres as one. `parseFloat`
// was wrong three ways at once here: `parseFloat("1e400")` is `Infinity`, which passed a
// `!isNaN && >= 0` guard and reached a `numeric(10,2)` column that PostgreSQL 14+ happily
// accepts; `1e9` overflowed the same column into a 500; and `19.999` was silently rounded
// to `20.00`, charging a price the seller never typed.
//
// The column is `numeric(10,2)` — 10 significant digits, 2 after the point — so the
// representable maximum is 99999999.99. Rejecting a third decimal place rather than
// rounding it is deliberate: a seller who typed one number and got another has been
// wronged quietly, which is worse than being told to try again.

/** 1 to 8 integer digits, optionally 1 or 2 decimal places. Anchored on purpose. */
const PRICE_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

const PRICE_MAX = "99999999.99";

const priceField = z
  .union([z.string(), z.number()])
  .transform((val, ctx): string => {
    // A number input is canonicalised through its own decimal form. `Number.isFinite`
    // rejects Infinity and NaN before they can reach the pattern as "Infinity"/"NaN".
    if (typeof val === "number") {
      if (!Number.isFinite(val)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "price must be a finite number",
        });
        return z.NEVER;
      }
      if (val < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "price must not be negative",
        });
        return z.NEVER;
      }
      // toFixed(2) on a number that already has at most 2 places is exact; one with more
      // is caught by the pattern check below rather than silently rounded here.
      if (!Number.isInteger(val * 100)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "price may have at most 2 decimal places",
        });
        return z.NEVER;
      }
      if (val > Number(PRICE_MAX)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `price is too large — the maximum is ${PRICE_MAX}`,
        });
        return z.NEVER;
      }
      return val.toFixed(2);
    }

    const raw = val.trim();

    if (raw.startsWith("-")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "price must not be negative",
      });
      return z.NEVER;
    }

    // One anchored pattern covers "", whitespace, "abc", "12.34.56", "1,234.56", "0x10",
    // "12e2", "Infinity" and "NaN" — every one of which parseFloat either accepted or
    // turned into something the column could not hold.
    if (!PRICE_PATTERN.test(raw)) {
      // Separate the rounding case out, because "you typed too many decimals" is
      // actionable and "that is not a price" is not.
      if (/^\d+\.\d{3,}$/.test(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "price may have at most 2 decimal places",
        });
        return z.NEVER;
      }
      if (/^\d{9,}(\.\d{1,2})?$/.test(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `price is too large — the maximum is ${PRICE_MAX}`,
        });
        return z.NEVER;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "price must be a decimal number, for example 1234.56",
      });
      return z.NEVER;
    }

    // Canonical form, so "19.5" and "19.50" reach the column identically.
    const [whole, fraction = ""] = raw.split(".");
    return `${whole}.${fraction.padEnd(2, "0")}`;
  });
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Fix the consumers**

```bash
cd c2c-e-commerce && npx tsc --noEmit
```

`price` is now a `string` wherever `CreateListingSchema` or `UpdateListingSchema` is consumed. Every error `tsc` reports is a place that was previously converting a number to a string, or relying on coercion; each becomes a direct assignment. Fix them all, then re-run `tsc` until clean.

- [ ] **Step 6: Deliberate break**

Temporarily replace the `PRICE_PATTERN.test(raw)` guard with `true`. Re-run the test.

Expected: FAIL on **"rejects 1e400"** and **"rejects more than two decimal places rather than rounding"**, by name. Restore.

- [ ] **Step 7: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

No background flag, timeout 900000 ms.

```bash
git add c2c-e-commerce/src
git commit -m "fix(api): validate money as a bounded decimal string

parseFloat accepted Infinity, overflowed numeric(10,2) into a 500, and
rounded 19.999 to 20.00 without telling the seller. Prices are now
validated against an anchored decimal pattern, bounded to what the column
can hold, and handed to Postgres as a string so they never round-trip
through a float."
```

---

## Task 5: Email normalisation

**Files:**
- Modify: `c2c-e-commerce/src/lib/validation.ts:82` (`RegisterBodySchema.email`)
- Modify: `c2c-e-commerce/src/app/api/auth/register/route.ts:111-131`
- Modify: `c2c-e-commerce/src/app/api/auth/oauth/[provider]/callback/route.ts` (the `eq(users.email, …)` lookup)
- Create: `c2c-e-commerce/drizzle/0019_users_email_lower.sql`
- Modify: `c2c-e-commerce/drizzle/meta/_journal.json`
- Create: `c2c-e-commerce/src/app/api/auth/register/email-casing.integration.test.ts`

**Interfaces:**
- Consumes: `isUniqueViolation(err, indexName)` from `src/db/pg-errors.ts`.
- Produces: `USERS_EMAIL_LOWER_INDEX = "users_email_lower_idx"` exported from `src/db/users.ts` (create the file if it does not exist, following `src/db/reviews.ts`'s `ONE_REVIEW_PER_ORDER_INDEX`). Task 3's login account key already lowercases independently, so it needs nothing from here.

**Operational gate — read before writing the migration.** This migration refuses to run on a collision. Before it ships, the developer runs this against their own database. No task in this plan may run it for them:

```sql
SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
```

- [ ] **Step 1: Write the failing test**

Create `c2c-e-commerce/src/app/api/auth/register/email-casing.integration.test.ts`:

```ts
/**
 * Registration used to store whatever casing the caller typed, so `A@x.com` and
 * `a@x.com` became two accounts. The OAuth callback then looked the user up with
 * `eq(users.email, profile.email)` and missed the existing one, quietly creating a
 * third. Separately, two simultaneous registrations of one address raced past the
 * pre-check and produced a 500 rather than a 409.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/register/route";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { truncateAll } from "@/test/harness/db";

const register = (email: string) =>
  POST(
    new NextRequest("http://test/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "correct-horse-battery",
        name: "Test Person",
      }),
    }),
  );

describe("registration email casing", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("stores the address lowercased", async () => {
    const response = await register("Seller@Example.TEST");
    expect(response.status).toBe(201);

    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("seller@example.test");
  });

  it("refuses a second account differing only by case", async () => {
    expect((await register("seller@example.test")).status).toBe(201);

    const second = await register("SELLER@EXAMPLE.TEST");
    expect(second.status).toBe(409);

    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("answers 409, never 500, when two identical registrations race", async () => {
    // Both requests pass the pre-check before either insert lands. The unique index is
    // what actually decides, and the loser must be mapped to a conflict rather than
    // surfacing as an unhandled constraint violation.
    const [a, b] = await Promise.all([
      register("racer@example.test"),
      register("racer@example.test"),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    expect(await db.select().from(users)).toHaveLength(1);
  });
});
```

Match the existing integration tests' import of the truncation helper — check `src/test/setup/integration.ts` for the exact name and use that.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project integration src/app/api/auth/register/email-casing.integration.test.ts
```

Expected: FAIL — the address is stored with its original casing, the second registration succeeds, and the race produces a 500.

- [ ] **Step 3: Write the migration**

Create `c2c-e-commerce/drizzle/0019_users_email_lower.sql`:

```sql
-- Email is an identity, and identities are case-insensitive in practice. Storing the
-- caller's casing let `A@x.com` and `a@x.com` become two accounts, and made the OAuth
-- callback's `email = $1` lookup miss an account that already existed.
--
-- This migration refuses rather than guesses. Two accounts that differ only by case are
-- a decision about people's data, not something a migration may resolve by picking a
-- winner -- exactly the stance 0015 takes when it cannot collapse a row losslessly.
DO $$
DECLARE
  collisions text;
BEGIN
  SELECT string_agg(DISTINCT lower(email), ', ')
    INTO collisions
    FROM "users"
   GROUP BY lower(email)
  HAVING count(*) > 1;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot lowercase emails: these addresses would collide: %. Resolve them by hand, then re-run.',
      collisions;
  END IF;
END $$;

DO $$
DECLARE
  changed integer;
BEGIN
  UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");
  GET DIAGNOSTICS changed = ROW_COUNT;
  RAISE NOTICE 'Lowercased % email address(es).', changed;
END $$;

-- Structural, not conventional: the schema now refuses a duplicate regardless of which
-- code path writes it.
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (lower("email"));
```

Add the journal entry to `c2c-e-commerce/drizzle/meta/_journal.json`, copying the shape of entry `18` and incrementing `idx` to `19`, `tag` to `"0019_users_email_lower"`, with a `when` timestamp in milliseconds. **A migration with no journal entry silently never runs.**

- [ ] **Step 4: Verify the migration replays**

```bash
cd c2c-e-commerce && npx vitest run --project integration src/test/harness/db-setup.integration.test.ts
```

Expected: PASS. This spins a fresh container and replays every migration from `0000`, which is the only safe way to exercise `0019`.

- [ ] **Step 5: Write the application changes**

In `validation.ts:82`, normalise on the way in:

```ts
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("email must be a valid email address"),
```

In `register/route.ts`, keep the friendly pre-check but make the index the decider. Replace the insert (`:128-130`) with:

```ts
    let user;
    try {
      [user] = await db
        .insert(users)
        .values({ email, passwordHash, name, phoneNumber: phoneNumber ?? null, role })
        .returning();
    } catch (err) {
      // The pre-check above is a courtesy; two simultaneous registrations both pass it
      // and only the index decides. Reaching here is a real conflict, not a server
      // fault, and it used to surface as a 500.
      if (isUniqueViolation(err, USERS_EMAIL_LOWER_INDEX)) {
        return jsonError("An account with that email already exists", 409);
      }
      throw err;
    }
```

Import `isUniqueViolation` from `@/db/pg-errors` and `USERS_EMAIL_LOWER_INDEX` from `@/db/users`.

Create `c2c-e-commerce/src/db/users.ts` if absent:

```ts
/**
 * The unique index behind `users.email`.
 *
 * Named here rather than inline at the call site so the string the route matches on and
 * the string the migration creates cannot drift apart silently -- a mismatch makes the
 * 409 branch dead code and the 500 comes back, with every happy-path test still green.
 */
export const USERS_EMAIL_LOWER_INDEX = "users_email_lower_idx";
```

In the OAuth callback, normalise the provider's address before the lookup, since a provider may return any casing:

```ts
    const email = profile.email.trim().toLowerCase();
```

and use that local in the `eq(users.email, …)` comparison and in the insert.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project integration src/app/api/auth/register/email-casing.integration.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Deliberate break**

Temporarily change `USERS_EMAIL_LOWER_INDEX` to `"users_email_lower_idxx"`. Re-run.

Expected: FAIL on **"answers 409, never 500, when two identical registrations race"** — the branch stops matching and the 500 returns. This is the check that matters most here, because a wrong index name is silent: every happy-path test still passes. Restore.

- [ ] **Step 8: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src c2c-e-commerce/drizzle
git commit -m "fix(auth): normalise email casing and answer 409 on a raced duplicate

A@x.com and a@x.com could become two accounts, and the OAuth callback's
exact-match lookup then missed the one that already existed. Lowercased in
the schema and enforced by a unique index on lower(email), so the invariant
is structural. The migration refuses to run if lowercasing would collide."
```

---

## Task 6: Shared-library hygiene

Three unrelated one-file fixes, batched because each is a handful of lines and they share a review surface: all three are library-level guards that routes depend on without knowing it.

**Files:**
- Modify: `c2c-e-commerce/src/lib/auth.ts:85-90` (`verifyToken`)
- Modify: `c2c-e-commerce/src/lib/auth.test.ts`
- Modify: `c2c-e-commerce/src/lib/params.ts` (add `parseBoundedInt`)
- Modify: `c2c-e-commerce/src/lib/params.test.ts`
- Modify: `c2c-e-commerce/src/lib/listings-query.ts:143-147` (page/limit), `:202` (wildcards)
- Modify: `c2c-e-commerce/src/app/api/listings/[id]/similar/route.ts:173`
- Modify: `c2c-e-commerce/src/app/api/recommendations/route.ts:228`
- Modify: `c2c-e-commerce/src/app/api/users/[id]/reviews/route.ts:171`
- Modify: `c2c-e-commerce/src/lib/listings-query.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseBoundedInt(raw: string | null | undefined, opts: { fallback: number; min?: number; max: number }): number` from `src/lib/params.ts`. `verifyToken` keeps its `(token: string) => TokenPayload` signature but now throws on a malformed payload.

- [ ] **Step 1: Write the failing tests**

Append to `c2c-e-commerce/src/lib/params.test.ts`:

```ts
describe("parseBoundedInt", () => {
  const opts = { fallback: 20, max: 100 };

  it("parses a plain integer", () => {
    expect(parseBoundedInt("42", opts)).toBe(42);
  });

  it("falls back when absent", () => {
    expect(parseBoundedInt(null, opts)).toBe(20);
    expect(parseBoundedInt(undefined, opts)).toBe(20);
    expect(parseBoundedInt("", opts)).toBe(20);
  });

  // The idiom this replaces was `parseInt(raw) || fallback`, which is prefix-tolerant:
  // "7abc" became 7, and a security boundary must not quietly reinterpret input.
  it.each(["7abc", "abc", "1.5", "0x10", " ", "-"])(
    "falls back rather than reinterpreting %o",
    (raw) => {
      expect(parseBoundedInt(raw, opts)).toBe(20);
    },
  );

  it("clamps to max", () => {
    expect(parseBoundedInt("1000", opts)).toBe(100);
  });

  it("clamps to min, which defaults to 1", () => {
    expect(parseBoundedInt("0", opts)).toBe(1);
    expect(parseBoundedInt("-5", opts)).toBe(1);
    expect(parseBoundedInt("0", { ...opts, min: 0 })).toBe(0);
  });
});
```

Append to `c2c-e-commerce/src/lib/auth.test.ts`:

```ts
describe("verifyToken payload validation", () => {
  // Every authorization predicate in the app trusts what this returns. It held only
  // because signToken is the sole issuer -- an assumption nothing enforced.
  it.each([
    ["a missing sub", { email: "a@x.test", role: "buyer" }],
    ["a non-numeric sub", { sub: "7", email: "a@x.test", role: "buyer" }],
    ["a missing email", { sub: 7, role: "buyer" }],
    ["a role outside the enum", { sub: 7, email: "a@x.test", role: "superuser" }],
    ["a missing role", { sub: 7, email: "a@x.test" }],
  ])("rejects a token carrying %s", (_label, payload) => {
    const token = jwt.sign(payload, process.env.JWT_SECRET!, {
      algorithm: "HS256",
      expiresIn: "15m",
    });

    expect(() => verifyToken(token)).toThrow();
  });

  it("still accepts a well-formed payload", () => {
    const token = signToken({ sub: 7, email: "a@x.test", role: "seller" });
    expect(verifyToken(token)).toEqual(
      expect.objectContaining({ sub: 7, email: "a@x.test", role: "seller" }),
    );
  });
});
```

Append to `c2c-e-commerce/src/lib/listings-query.test.ts`:

```ts
describe("search wildcard escaping", () => {
  // A LIKE pattern treats % and _ as wildcards, so a search for "50%" matched every
  // listing in the marketplace.
  it("treats % as a literal", () => {
    const built = buildListingQuery(new URLSearchParams({ search: "50%" }), null);
    expect(built.ok).toBe(true);
    expect(built.ok && built.query.search).toBe("50%");
    // The SQL fragment must carry an escaped percent, not a bare one.
    expect(JSON.stringify(built.ok && built.query.where)).toContain("50\\%");
  });

  it("treats _ as a literal", () => {
    const built = buildListingQuery(new URLSearchParams({ search: "a_b" }), null);
    expect(JSON.stringify(built.ok && built.query.where)).toContain("a\\_b");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/params.test.ts src/lib/auth.test.ts src/lib/listings-query.test.ts
```

Expected: FAIL — `parseBoundedInt` is not exported, `verifyToken` returns a malformed payload without throwing, and the search term reaches the pattern unescaped.

- [ ] **Step 3: Write the implementations**

Append to `c2c-e-commerce/src/lib/params.ts`:

```ts
/**
 * Parse a bounded integer from a query parameter.
 *
 * Strict for the same reason `parseResourceId` is: the `parseInt(raw, 10) || fallback`
 * idiom this replaces is prefix-tolerant, so "7abc" became 7, and `|| fallback` also
 * swallows a legitimate 0. Four call sites had grown their own copy of that idiom, two
 * of them byte-identical including a comment warning against it.
 */
export function parseBoundedInt(
  raw: string | null | undefined,
  { fallback, min = 1, max }: { fallback: number; min?: number; max: number },
): number {
  if (raw === null || raw === undefined) return fallback;

  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return fallback;

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return fallback;

  return Math.min(max, Math.max(min, value));
}
```

Replace `verifyToken` in `c2c-e-commerce/src/lib/auth.ts`:

```ts
/**
 * The shape a token must actually carry.
 *
 * `jwt.verify` proves the signature and nothing about the payload, so casting its result
 * to `TokenPayload` asserted a shape no code checked. Every authorization predicate
 * downstream trusted that cast; it held only because `signToken` is the sole issuer,
 * which is an assumption rather than a guarantee.
 */
const TokenPayloadSchema = z.object({
  sub: z.number().int().positive(),
  email: z.string().min(1),
  role: z.enum(["buyer", "seller", "admin"]),
});

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: [JWT_ALGORITHM],
  });

  // Throws on a malformed payload, which `authenticate` already turns into a 401 the
  // same way it handles a bad signature.
  return TokenPayloadSchema.parse(decoded);
}
```

Import `z` from `zod` in `auth.ts`.

In `listings-query.ts`, replace the page/limit parsing at `:143-147`:

```ts
  const page = parseBoundedInt(searchParams.get("page"), {
    fallback: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const limit = parseBoundedInt(searchParams.get("limit"), { fallback: 20, max: 100 });
```

and escape the search term before it becomes a `LIKE` pattern:

```ts
/**
 * Escape the characters `LIKE` treats as wildcards.
 *
 * Without this a search for "50%" matches every row, and one for "a_b" matches "axb" —
 * the user's literal text silently becoming a pattern.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}
```

```ts
  const keywordConditions =
    search && mode.mode === "keyword"
      ? [...conditions, ilike(listings.title, `%${escapeLikePattern(search)}%`)]
      : conditions;
```

Then replace the three remaining hand-rolled parsers with `parseBoundedInt`, keeping each call site's existing fallback and maximum exactly as they are today: `similar/route.ts:173`, `recommendations/route.ts:228`, `users/[id]/reviews/route.ts:171`. Read each line's current numbers and pass those, changing no behaviour except the strictness.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/params.test.ts src/lib/auth.test.ts src/lib/listings-query.test.ts
cd c2c-e-commerce && npx tsc --noEmit
```

Expected: PASS, `tsc` clean.

- [ ] **Step 5: Deliberate break**

Temporarily change `TokenPayloadSchema.parse(decoded)` back to `decoded as unknown as TokenPayload`. Re-run `auth.test.ts`.

Expected: FAIL on all five **"rejects a token carrying …"** cases. Restore.

- [ ] **Step 6: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src
git commit -m "fix(api): parse the token payload, bound query ints, escape LIKE wildcards

verifyToken asserted a payload shape nothing checked -- the one place in
this codebase where an illegal state was representable and unchecked.
parseBoundedInt collapses four drifting copies of a prefix-tolerant idiom
two of them warned against in their own comments. And a search for "50%"
no longer matches every listing."
```

---

## Task 7: Extract the image pipeline

**Files:**
- Create: `c2c-e-commerce/src/lib/image-pipeline.ts`
- Create: `c2c-e-commerce/src/lib/image-pipeline.test.ts`
- Modify: `c2c-e-commerce/src/app/api/listings/[id]/images/route.ts:120-157`

**Interfaces:**
- Consumes: `sniffImageType` from `src/lib/image-type.ts`.
- Produces:
  - `type ProcessedImage = { webp: Buffer; width: number; height: number }`
  - `class ImageProcessingError extends Error` with `kind: "not_an_image" | "undecodable"`
  - `processUploadedImage(incoming: Buffer): Promise<ProcessedImage>`

Task 9 consumes `processUploadedImage` and `ImageProcessingError`.

This is a pure refactor: no behaviour changes. The sniff, decode, rotate, resize and re-encode currently sit inline in `POST`, so they can only be exercised through a slow integration test carrying real image bytes — while `sniffImageType`, doing far less, is extracted and unit-tested.

- [ ] **Step 1: Write the failing test**

Create `c2c-e-commerce/src/lib/image-pipeline.test.ts`:

```ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ImageProcessingError, processUploadedImage } from "@/lib/image-pipeline";

// Real bytes, generated in-process: a fixture file would be one more thing to keep in
// sync with what the pipeline actually accepts.
async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 90 } },
  })
    .png()
    .toBuffer();
}

describe("processUploadedImage", () => {
  it("re-encodes to WebP and reports the stored dimensions", async () => {
    const result = await processUploadedImage(await png(800, 600));

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    // Re-encoding is the security property, not a nicety: it drops EXIF (including phone
    // GPS) and a decode-then-encode cycle cannot carry a polyglot payload through.
    expect((await sharp(result.webp).metadata()).format).toBe("webp");
  });

  it("resizes down to the 4000px bound without enlarging", async () => {
    const large = await processUploadedImage(await png(5000, 2500));
    expect(large.width).toBe(4000);
    expect(large.height).toBe(2000);

    const small = await processUploadedImage(await png(100, 50));
    expect(small.width).toBe(100);
  });

  it("rejects bytes that are not an image at all", async () => {
    await expect(processUploadedImage(Buffer.from("<html>nope</html>"))).rejects.toThrow(
      expect.objectContaining({ kind: "not_an_image" }),
    );
  });

  it("rejects bytes that sniff as an image but cannot be decoded", async () => {
    // A valid PNG magic number followed by rubbish: passes the sniff, fails the decode.
    const truncated = Buffer.concat([
      (await png(10, 10)).subarray(0, 16),
      Buffer.alloc(64, 0),
    ]);

    await expect(processUploadedImage(truncated)).rejects.toBeInstanceOf(
      ImageProcessingError,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/image-pipeline.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/image-pipeline"`.

- [ ] **Step 3: Write the implementation**

Create `c2c-e-commerce/src/lib/image-pipeline.ts`, moving the logic verbatim out of the route and keeping its comments — they explain security properties that would otherwise be lost:

```ts
import sharp from "sharp";

import { sniffImageType } from "@/lib/image-type";

export type ProcessedImage = {
  webp: Buffer;
  width: number;
  height: number;
};

export type ImageProcessingErrorKind = "not_an_image" | "undecodable";

export class ImageProcessingError extends Error {
  readonly kind: ImageProcessingErrorKind;

  constructor(
    message: string,
    kind: ImageProcessingErrorKind,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ImageProcessingError";
    this.kind = kind;
  }
}

/**
 * Decode, normalise and re-encode an uploaded image to WebP.
 *
 * Re-encoding is the point, not a formatting nicety: it drops EXIF -- including the GPS
 * coordinates phone cameras attach -- and a decode-then-encode cycle cannot carry a
 * polyglot payload through (D10).
 *
 * The caller's size checks bound the *compressed* bytes only. Without a decode-side
 * bound, a 5 MB PNG or WebP can still be crafted to decode to ~200 megapixels -- sharp's
 * own default ceiling -- which allocates roughly 600 MB of raw pixels in this process.
 * `limitInputPixels` caps that; `resize` additionally caps what gets stored.
 */
export async function processUploadedImage(incoming: Buffer): Promise<ProcessedImage> {
  // The bytes decide, not the multipart Content-Type and not the filename.
  if (sniffImageType(incoming) === null) {
    throw new ImageProcessingError(
      "That file is not a JPEG, PNG or WebP image",
      "not_an_image",
    );
  }

  try {
    const output = await sharp(incoming, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 4000, height: 4000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return { webp: output.data, width: output.info.width, height: output.info.height };
  } catch (err) {
    // Sniffed as an image but undecodable: truncated, crafted to look like one, or
    // rejected by limitInputPixels.
    throw new ImageProcessingError("That image could not be processed", "undecodable", {
      cause: err,
    });
  }
}
```

In the route, replace lines 120-157 with a call, mapping each error kind to the status the route already returned:

```ts
    let processed;
    try {
      processed = await processUploadedImage(incoming);
    } catch (err) {
      if (err instanceof ImageProcessingError) {
        // Logged even though the response is a 400: this branch failing broadly (a
        // broken sharp binary, an OOM) would otherwise look like "every upload is
        // suddenly invalid" with no server-side trace.
        if (err.kind === "undecodable") {
          console.warn("[POST /api/listings/[id]/images] decode failed", err.cause);
        }
        return jsonError(err.message, 400);
      }
      throw err;
    }
```

The route's later references to `webp`, `width` and `height` become `processed.webp`, `processed.width`, `processed.height`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/image-pipeline.test.ts
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/listings/[id]/images/route.integration.test.ts"
```

Expected: PASS both. The integration test is the proof this refactor changed no behaviour — it must pass without edits.

- [ ] **Step 5: Commit**

```bash
git add c2c-e-commerce/src
git commit -m "refactor(images): extract processUploadedImage so it can be unit-tested"
```

---

## Task 8: Unique index on image sort order

**Files:**
- Create: `c2c-e-commerce/drizzle/0020_listing_images_sort_order.sql`
- Modify: `c2c-e-commerce/drizzle/meta/_journal.json`
- Modify: `c2c-e-commerce/src/db/schema/index.ts` (declare the index alongside the table)
- Modify: `c2c-e-commerce/src/db/listing-images.ts` (export the index name)

**Interfaces:**
- Consumes: nothing.
- Produces: `LISTING_IMAGES_SORT_INDEX = "listing_images_listing_sort_idx"` exported from `src/db/listing-images.ts`. Task 9 uses it.

Additive only, so the tree compiles and every existing test passes at this task's boundary. Task 9 is what starts relying on it.

- [ ] **Step 1: Write the migration**

Create `c2c-e-commerce/drizzle/0020_listing_images_sort_order.sql`:

```sql
-- `nextSortOrder` is a read-then-write: two concurrent uploads to one listing both read
-- the same MAX and both write it back, so they collide and the cover image becomes
-- whichever id happens to sort first. Task 9 serialises the writers with a row lock; this
-- index is the backstop that makes the collision unrepresentable rather than merely
-- unlikely -- the same shape as orders_one_live_per_listing_idx and
-- reviews_one_per_order_idx.
DO $$
DECLARE
  duplicates integer;
BEGIN
  SELECT count(*) INTO duplicates FROM (
    SELECT "listing_id", "sort_order"
      FROM "listing_images"
     GROUP BY "listing_id", "sort_order"
    HAVING count(*) > 1
  ) AS d;

  IF duplicates > 0 THEN
    RAISE NOTICE 'Renumbering % duplicated (listing_id, sort_order) pair(s).', duplicates;
  END IF;
END $$;

-- Deterministic by id, so a re-run produces the same order and the existing cover image
-- (lowest sort_order, then lowest id) keeps its place wherever it already won.
WITH renumbered AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "listing_id" ORDER BY "sort_order", "id") - 1
           AS "new_sort_order"
    FROM "listing_images"
)
UPDATE "listing_images" li
   SET "sort_order" = r."new_sort_order"
  FROM renumbered r
 WHERE li."id" = r."id"
   AND li."sort_order" <> r."new_sort_order";

CREATE UNIQUE INDEX "listing_images_listing_sort_idx"
    ON "listing_images" ("listing_id", "sort_order");
```

Add the journal entry to `c2c-e-commerce/drizzle/meta/_journal.json`, copying the shape of entry `19` and incrementing: `idx` `20`, `tag` `"0020_listing_images_sort_order"`, `when` in milliseconds. **A migration with no journal entry silently never runs.**

- [ ] **Step 2: Declare the index in the schema and export its name**

In `c2c-e-commerce/src/db/schema/index.ts`, add the unique index to the `listingImages` table definition so Drizzle's model matches the database.

In `c2c-e-commerce/src/db/listing-images.ts`, add:

```ts
/**
 * The unique index behind (listing_id, sort_order).
 *
 * Named here rather than inline so the string a handler matches on and the string the
 * migration creates cannot drift apart silently -- a mismatch makes the conflict branch
 * dead code, and every happy-path test stays green.
 */
export const LISTING_IMAGES_SORT_INDEX = "listing_images_listing_sort_idx";
```

- [ ] **Step 3: Verify the migration replays**

```bash
cd c2c-e-commerce && npx vitest run --project integration src/test/harness/db-setup.integration.test.ts
```

Expected: PASS — a fresh container replays every migration from `0000` through `0020`.

- [ ] **Step 4: Run the full suite**

```bash
cd c2c-e-commerce && npm test
```

No background flag, timeout 900000 ms. Expected: all green. Nothing depends on the index yet, so a failure here means the migration or the renumbering is wrong.

- [ ] **Step 5: Commit**

```bash
git add c2c-e-commerce/drizzle c2c-e-commerce/src
git commit -m "feat(db): unique index on (listing_id, sort_order)"
```

---

## Task 9: Upload handler — length gate, row lock, detectable failure

**Files:**
- Modify: `c2c-e-commerce/src/lib/storage.ts:11-15` (`PutOptions`), `:71-72` and the memory driver's `put`
- Modify: `c2c-e-commerce/src/db/listing-images.ts` (`countImagesFor`, `nextSortOrder`, `insertImage` take an executor)
- Modify: `c2c-e-commerce/src/app/api/listings/[id]/images/route.ts` (the count check at `:93`, the gate at `:103`, the write at `:159-172`)
- Modify: `c2c-e-commerce/src/app/api/images/[id]/route.ts:90-93`
- Create: `c2c-e-commerce/src/app/api/listings/[id]/images/concurrency.integration.test.ts`

**Interfaces:**
- Consumes: `processUploadedImage`, `ImageProcessingError` (Task 7); `LISTING_IMAGES_SORT_INDEX` (Task 8); `isUniqueViolation` (`src/db/pg-errors.ts`); `storageKey` (`src/lib/storage.ts`).
- Produces: nothing later tasks depend on.

Three defects, one lock. The size gate is skipped when `Content-Length` is absent, because `Number(null)` is `0` — finite and under the cap. The sort order is a read-then-write. The image-count cap is a TOCTOU with no constraint behind it.

- [ ] **Step 1: Write the failing test**

Create `c2c-e-commerce/src/app/api/listings/[id]/images/concurrency.integration.test.ts`. Read the neighbouring `route.integration.test.ts` first and reuse its seeding helpers and its PNG-bytes helper rather than writing new ones:

```ts
/**
 * Three races, one lock. Concurrent uploads to one listing used to collide on sort_order
 * (making the cover image arbitrary) and to pass the count check together (exceeding the
 * cap). A body with no Content-Length used to skip the size gate entirely, because
 * Number(null) is 0 -- finite, and under any cap.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST, MAX_IMAGES_PER_LISTING } from "@/app/api/listings/[id]/images/route";
import { listImagesFor } from "@/db/listing-images";

describe("concurrent uploads to one listing", () => {
  it("assigns distinct sort orders", async () => {
    const { listing, token } = await seedSellerWithListing();

    await Promise.all([
      upload(listing.id, token),
      upload(listing.id, token),
      upload(listing.id, token),
    ]);

    const images = await listImagesFor(listing.id);
    const orders = images.map((image) => image.sortOrder).sort((a, b) => a - b);

    expect(images).toHaveLength(3);
    expect(orders).toEqual([0, 1, 2]);
  });

  it("never exceeds the image cap under concurrency", async () => {
    const { listing, token } = await seedSellerWithListing();

    // Several more than the cap, all at once. Without the lock the count check is a
    // TOCTOU and a batch of requests passes it together.
    await Promise.all(
      Array.from({ length: MAX_IMAGES_PER_LISTING + 3 }, () => upload(listing.id, token)),
    );

    expect(await listImagesFor(listing.id)).toHaveLength(MAX_IMAGES_PER_LISTING);
  });
});

describe("the size gate", () => {
  it("refuses a body with no Content-Length rather than buffering it", async () => {
    const { listing, token } = await seedSellerWithListing();

    const form = new FormData();
    form.set("file", new Blob([await pngBytes()], { type: "image/png" }), "a.png");

    const request = new NextRequest(`http://test/api/listings/${listing.id}/images`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    // Strip what the runtime added: this is the chunked case, where the header is absent.
    request.headers.delete("content-length");

    const response = await POST(request, {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(411);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/listings/[id]/images/concurrency.integration.test.ts"
```

Expected: FAIL — duplicate sort orders, more rows than the cap, and 201 instead of 411.

- [ ] **Step 3: Let the storage provider accept a caller-supplied key**

In `c2c-e-commerce/src/lib/storage.ts`:

```ts
export type PutOptions = {
  contentType: string;
  /** Directory-ish namespace, e.g. `listings/42`. Server-generated. */
  prefix: string;
  /**
   * Write under this exact key instead of generating one.
   *
   * Only ever a key from `storageKey()`. Every driver still validates through
   * `isValidStorageKey` before touching its backing store, so the whitelist guarantee is
   * unchanged: a caller cannot smuggle a path in here.
   */
  key?: string;
};
```

In both `LocalStorageProvider.put` (`:72`) and the memory driver's `put` (`:117`), replace the key line with:

```ts
    const key = opts.key ?? storageKey(opts.prefix, extensionFor(opts.contentType));
```

Both already validate immediately afterwards, so nothing else changes.

- [ ] **Step 4: Let the image helpers run inside a transaction**

In `c2c-e-commerce/src/db/listing-images.ts`, follow the `OrderExecutor` pattern already established in `src/db/orders.ts`: define an executor type, give `countImagesFor`, `nextSortOrder` and `insertImage` an executor parameter defaulting to the module `db`, and use it in place of `db` inside each.

- [ ] **Step 5: Rewrite the gate and the write**

In `c2c-e-commerce/src/app/api/listings/[id]/images/route.ts`, replace the Content-Length gate:

```ts
    // Cheapest gate first: App Router route handlers have no default body cap, so
    // `await request.formData()` below buffers the whole body into memory before
    // `file.size` is ever consulted. This check is what keeps an oversized upload's
    // memory cost off the process; the two size checks after formData() only bound what
    // has already been paid for.
    //
    // A missing header is not zero. `Number(null)` is 0 -- finite, and under any cap --
    // so treating it as a size let a chunked body skip this gate entirely and buffer
    // without limit. 411 is the status that actually means "tell me how big it is".
    const rawLength = request.headers.get("content-length");
    const contentLength = rawLength === null ? Number.NaN : Number(rawLength);

    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return jsonError("A Content-Length header is required for uploads", 411);
    }
    // The allowance above MAX_BYTES accounts for the multipart envelope.
    if (contentLength > MAX_BYTES + 1024 * 1024) {
      return jsonError("That image is larger than 5 MB", 413);
    }
```

Delete the pre-transaction count check at `:93-95` — it moves inside the lock.

Replace the write at `:159-172`:

```ts
    // The key is generated here so the row can be written before the object. Two systems
    // cannot be atomic, so this does not remove the failure -- it converts it into one
    // that is detectable and repairable. Object-then-row leaves an *untracked* orphan:
    // no row, so nothing can ever enumerate it. Row-then-object leaves a row pointing at
    // a missing object, which a sweep can find.
    const key = storageKey(`listings/${listingId}`, "webp");

    // One row lock, three races. The image-count TOCTOU, nextSortOrder's read-then-write
    // and the ordering above are one serialisation problem: concurrent uploads to the
    // same listing queue behind this lock, and uploads to different listings never
    // contend. The unique index from migration 0020 is the backstop.
    const image = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.id, listingId))
        .for("update")
        .limit(1);

      // Deleted between the authorisation read and this lock.
      if (!locked) return null;

      if ((await countImagesFor(listingId, tx)) >= MAX_IMAGES_PER_LISTING) {
        throw new ImageLimitReached();
      }

      return insertImage(
        {
          listingId,
          storageKey: key,
          contentType: "image/webp",
          byteSize: processed.webp.byteLength,
          width: processed.width,
          height: processed.height,
          sortOrder: await nextSortOrder(listingId, tx),
        },
        tx,
      );
    });

    if (image === null) return jsonError("Listing not found", 404);

    try {
      await getStorageProvider().put(processed.webp, {
        contentType: "image/webp",
        prefix: `listings/${listingId}`,
        key,
      });
    } catch (err) {
      // The row is committed and the object is not. Remove the row so the pair stays
      // consistent; if this also fails, the row survives pointing at a missing object --
      // the detectable failure this ordering was chosen for, logged rather than silent.
      try {
        await deleteImage(image.id);
      } catch (cleanupErr) {
        console.error(
          "[POST /api/listings/[id]/images] row left pointing at a missing object",
          image.id,
          key,
          cleanupErr,
        );
      }
      throw err;
    }
```

Define a local error class above the handler and map it in the existing `catch`:

```ts
/** The cap was reached while holding the listing's row lock. */
class ImageLimitReached extends Error {}
```

```ts
    if (err instanceof ImageLimitReached) {
      return jsonError(`A listing may have at most ${MAX_IMAGES_PER_LISTING} images`, 409);
    }
    // The backstop from migration 0020: a lost race is a conflict, not a server fault.
    if (isUniqueViolation(err, LISTING_IMAGES_SORT_INDEX)) {
      return jsonError("Another upload for this listing is in progress. Try again.", 409);
    }
```

If `deleteImage` does not already exist in `src/db/listing-images.ts`, add it next to `insertImage`, deleting one row by id.

- [ ] **Step 6: Fix the storage error status**

In `c2c-e-commerce/src/app/api/images/[id]/route.ts:90-93`, a `StorageError` currently returns 404 regardless of kind, which makes a broken mount indistinguishable from a deleted image:

```ts
    if (err instanceof StorageError) {
      // A missing object is a 404. An I/O fault is this server's problem, and reporting
      // it as "not found" hid a broken mount behind an ordinary-looking response.
      if (err.kind === "not_found") return jsonError("Image not found", 404);
      console.error("[GET /api/images/[id]] storage", err);
      return jsonError("Internal server error", 500);
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/listings/[id]/images" "src/app/api/images"
```

Expected: PASS, including the pre-existing upload tests unchanged.

- [ ] **Step 8: Deliberate break**

Temporarily remove `.for("update")` from the locking select. Re-run.

Expected: FAIL on **"assigns distinct sort orders"** or **"never exceeds the image cap under concurrency"**, by name. If both still pass, the test is not exercising concurrency — check the uploads really are issued through `Promise.all` and not awaited in sequence — and fix the test before continuing. Restore.

- [ ] **Step 9: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src
git commit -m "fix(images): require Content-Length, serialise uploads, write the row first

Number(null) is 0, so a chunked body skipped the size gate and buffered
without limit; that is now a 411. One FOR UPDATE row lock closes all three
upload races at once. And the row is written before the object, which does
not make the pair atomic but converts an untracked orphan into a row
pointing at a missing object -- a failure a sweep can find."
```

---

## Task 10: OAuth account creation in one transaction

**Files:**
- Modify: `c2c-e-commerce/src/app/api/auth/oauth/[provider]/callback/route.ts:209-227`
- Create: `c2c-e-commerce/src/app/api/auth/oauth/account-creation.integration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

The `users` row and its `oauth_accounts` link are separate statements. If the second fails, a passwordless account owns that email; the next callback returns `needs_link` and asks for a password that is `null`. The account becomes permanently unreachable — password login rejects it, OAuth cannot claim it, and linking demands a credential that does not exist.

- [ ] **Step 1: Write the failing test**

Create `c2c-e-commerce/src/app/api/auth/oauth/account-creation.integration.test.ts`. Drive it the way the neighbouring `route.integration.test.ts` drives the callback — read that file first and match its style rather than introducing a second one:

```ts
/**
 * The two writes used to be uncoordinated. A failure on the second left a passwordless
 * `users` row with no provider link: the next callback matched the email, returned
 * `needs_link`, and asked for a password that is null. The account was unreachable by
 * every route -- password login, OAuth, and linking alike.
 */
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { oauthAccounts, users } from "@/db/schema";

const PROFILE = {
  email: "new-person@example.test",
  name: "New Person",
  providerAccountId: "google-123",
  emailVerified: true,
  avatarUrl: null,
};

describe("OAuth account creation", () => {
  it("leaves no user row behind when the provider link cannot be written", async () => {
    // Force the second write to fail, exactly as a constraint violation or a dropped
    // connection would. Mocking the insert is the only way to reach this branch: nothing
    // in a healthy database makes the link write fail on its own.
    const realInsert = db.insert.bind(db);
    vi.spyOn(db, "insert").mockImplementation((table) => {
      if (table === oauthAccounts) throw new Error("link write failed");
      return realInsert(table);
    });

    await expect(findOrCreateOAuthUser("google", PROFILE)).rejects.toThrow();

    vi.restoreAllMocks();

    // Neither row may survive. A user with no link is the unreachable-account state.
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(oauthAccounts)).toHaveLength(0);
  });

  it("writes both rows on the happy path", async () => {
    const result = await findOrCreateOAuthUser("google", PROFILE);

    expect(result.outcome).toBe("ok");
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(oauthAccounts)).toHaveLength(1);
  });
});
```

If `findOrCreateOAuthUser` is not exported from the callback module, export it — it is the unit under test and driving it through the full OAuth redirect dance to reach one branch would make the test about the dance instead.

Note the mock replaces `db.insert` wholesale, so the transaction's `tx.insert` is untouched — which is exactly why this test fails before the fix and passes after it.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project integration src/app/api/auth/oauth/account-creation.integration.test.ts
```

Expected: FAIL on **"leaves no user row behind when the provider link cannot be written"** — one orphaned `users` row survives.

- [ ] **Step 3: Write the implementation**

Replace the two inserts:

```ts
  // One transaction, because the pair is the account. A `users` row without its provider
  // link is not a partial success -- it is an account nobody can ever sign into: password
  // login rejects it (passwordHash is null), and the next OAuth callback matches the
  // email, answers `needs_link`, and asks for the password that does not exist.
  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: profile.email.trim().toLowerCase(),
        // Never from the provider: SEC-1's rule holds on this path too.
        role: "buyer",
        passwordHash: null,
        name: profile.name ?? profile.email,
        emailVerified: profile.emailVerified,
        avatarUrl: profile.avatarUrl,
      })
      .returning();

    await tx.insert(oauthAccounts).values({
      userId: user.id,
      provider,
      providerAccountId: profile.providerAccountId,
      providerEmail: profile.email,
    });

    return user;
  });

  return { outcome: "ok", user: created };
```

The lowercasing is Task 5's normalisation applied on this path.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project integration src/app/api/auth/oauth/
```

Expected: PASS, including the existing OAuth suites.

- [ ] **Step 5: Deliberate break**

Temporarily change `tx.insert(oauthAccounts)` back to `db.insert(oauthAccounts)` — outside the transaction. Re-run.

Expected: FAIL on **"leaves no user row behind when the provider link cannot be written"**. Restore.

- [ ] **Step 6: Commit**

```bash
git add c2c-e-commerce/src
git commit -m "fix(auth): create the OAuth user and its provider link in one transaction

A failure on the second write left a passwordless account owning the
email: the next callback answered needs_link and asked for a password
that is null, so nobody could ever sign in as that person again."
```

---

## Task 11: Password change revokes sessions and requires the current password

**Files:**
- Modify: `c2c-e-commerce/src/lib/validation.ts` (`UpdateUserSchema`)
- Modify: `c2c-e-commerce/src/lib/refresh-token.ts` (add `revokeAllRefreshFamiliesForUser`)
- Modify: `c2c-e-commerce/src/app/api/users/[id]/route.ts:181-224`
- Modify: the frontend password-change call site (per D10)
- Create: `c2c-e-commerce/src/app/api/users/[id]/password-change.integration.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `hashPassword` (`src/lib/auth.ts`).
- Produces:
  - `revokeAllRefreshFamiliesForUser(x: RefreshExecutor, userId: number): Promise<number>` in `src/lib/refresh-token.ts`
  - `UpdateUserSchema` gains `currentPassword?: string`

Today the new hash is written and no refresh family is touched, so the standard remediation after a compromise leaves the attacker's 30-day refresh token live. `revokeRefreshTokenFamily` already exists in the same codebase and is simply not called.

- [ ] **Step 1: Write the failing test**

Create `c2c-e-commerce/src/app/api/users/[id]/password-change.integration.test.ts`. Build the helpers from `src/test/harness/factories.ts` and match how the neighbouring `route.integration.test.ts` seeds users and mints tokens:

```ts
/**
 * Changing a password is what a person does *after* they believe they were compromised.
 * Leaving the attacker's 30-day refresh token live makes the remediation theatre.
 */
import { describe, expect, it } from "vitest";

describe("password change", () => {
  it("revokes every refresh family for that user", async () => {
    const { user, accessToken, refreshToken } = await seedUserWithSession("old-password-1");

    const response = await PATCH(
      authed(accessToken, {
        currentPassword: "old-password-1",
        password: "new-password-2",
      }),
      { params: Promise.resolve({ id: String(user.id) }) },
    );
    expect(response.status).toBe(200);

    // The session an attacker would still be holding must be dead.
    expect((await refreshWith(refreshToken)).status).toBe(401);
  });

  it("rejects a self-change that does not prove the current password", async () => {
    const { user, accessToken } = await seedUserWithSession("old-password-1");

    const missing = await PATCH(authed(accessToken, { password: "new-password-2" }), {
      params: Promise.resolve({ id: String(user.id) }),
    });
    expect(missing.status).toBe(400);

    const wrong = await PATCH(
      authed(accessToken, {
        currentPassword: "not-the-password",
        password: "new-password-2",
      }),
      { params: Promise.resolve({ id: String(user.id) }) },
    );
    expect(wrong.status).toBe(403);

    // Positive control: after both rejections the old password must still work, so this
    // cannot pass against a handler that simply broke password changes altogether.
    expect(await loginStatus(user.email, "old-password-1")).toBe(200);
  });

  it("lets an admin reset another user's password without it", async () => {
    // An admin resetting a compromised account does not know the current password, and
    // demanding it would break the one case the reset exists for.
    const { user } = await seedUserWithSession("old-password-1");
    const admin = await seedAdminWithSession();

    const response = await PATCH(
      authed(admin.accessToken, { password: "reset-password-3" }),
      { params: Promise.resolve({ id: String(user.id) }) },
    );

    expect(response.status).toBe(200);
    expect(await loginStatus(user.email, "reset-password-3")).toBe(200);
  });

  it("does not require a current password for an account that has none", async () => {
    // OAuth-only accounts have passwordHash null: there is nothing to verify against, and
    // setting a first password must stay possible.
    const { user, accessToken } = await seedOAuthOnlyUserWithSession();

    const response = await PATCH(authed(accessToken, { password: "first-password-1" }), {
      params: Promise.resolve({ id: String(user.id) }),
    });

    expect(response.status).toBe(200);
  });
});
```

Note this file calls `PATCH`, which Task 18 introduces. Until then the handler is exported as `PUT` — write the test against `PUT` now and let Task 18 rename both together, or run this task after Task 18. Executing in numeric order, use `PUT` here and Task 18 updates it.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/users/[id]/password-change.integration.test.ts"
```

Expected: FAIL — the refresh token still works after the change, and a self-change with no `currentPassword` succeeds.

- [ ] **Step 3: Add the revocation helper**

In `c2c-e-commerce/src/lib/refresh-token.ts`, beside `revokeRefreshTokenFamily`:

```ts
/**
 * Revokes every live refresh token a user holds, across all families.
 *
 * `revokeRefreshTokenFamily` handles one family, which is right for reuse detection --
 * that is a statement about one lineage. A password change is a statement about the whole
 * account, so it takes all of them.
 */
export async function revokeAllRefreshFamiliesForUser(
  x: RefreshExecutor,
  userId: number,
): Promise<number> {
  const revoked = await x
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });

  return revoked.length;
}
```

If `refresh-token.ts` has no executor type yet, add one following `OrderExecutor` in `src/db/orders.ts`, so this can run inside the route's transaction.

- [ ] **Step 4: Write the handler changes**

In `validation.ts`, add to `UpdateUserSchema`:

```ts
  /**
   * Proof that the caller knows the password they are replacing.
   *
   * Optional in the schema and conditionally required in the handler, because the
   * condition depends on *who is calling* -- self or admin -- which a body schema cannot
   * see.
   */
  currentPassword: z.string().min(1).optional(),
```

In `users/[id]/route.ts`, replace the one-line password branch:

```ts
    const isSelfChange = payload.sub === id;

    if (password !== undefined) {
      // A self-change must prove knowledge of what it replaces. An admin reset is exempt:
      // an admin recovering a compromised account does not know the current password, and
      // requiring it would break the case the reset exists for. An account with no
      // password -- OAuth-only -- has nothing to prove against.
      if (isSelfChange && user.passwordHash !== null) {
        if (currentPassword === undefined) {
          return jsonError("currentPassword is required to change your own password", 400);
        }
        if (!(await verifyPassword(currentPassword, user.passwordHash))) {
          return jsonError("Current password is incorrect", 403);
        }
      }
      updates.passwordHash = await hashPassword(password);
    }
```

and make the write transactional, revoking sessions alongside it:

```ts
    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx
        .update(users)
        .set(updates)
        .where(eq(users.id, id))
        .returning();

      // A password change is remediation. Leaving every existing refresh family live
      // means the credential the person is trying to invalidate still works for another
      // 30 days -- so the revocation belongs in the same transaction as the new hash,
      // not beside it where a failure could commit one without the other.
      if (updates.passwordHash !== undefined) {
        await revokeAllRefreshFamiliesForUser(tx, id);
      }

      return rows;
    });
```

Destructure `currentPassword` from `parsed.data` alongside the existing fields.

- [ ] **Step 5: Update the frontend call site (D10)**

```bash
cd c2c-e-commerce && grep -rn "password" "src/app/(frontend)" src/components --include=*.tsx | grep -iv "placeholder\|type=\"password\"" | head -20
```

If a password-change form exists, add a "Current password" field sent as `currentPassword`, and surface the 403 message inline. If none exists — the settings page currently hosts only linked accounts — skip this step and say so in the commit body: the API change is backward compatible for admins and correctly rejects a self-change that cannot prove itself.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/users/[id]"
```

Expected: PASS, 4 new tests plus the existing suite.

- [ ] **Step 7: Deliberate break**

Temporarily remove the `revokeAllRefreshFamiliesForUser` call. Re-run.

Expected: FAIL on **"revokes every refresh family for that user"**, by name. Restore.

- [ ] **Step 8: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src
git commit -m "fix(sec): revoke sessions on password change and require the current one

Changing a password is what someone does after a compromise; leaving the
attacker's 30-day refresh token live made the remediation theatre. An admin
reset stays exempt from the current-password proof, because an admin
recovering a compromised account does not know it."
```

---

## Task 12: Auth hygiene

Four small fixes batched: they share no logic, but each is a few lines in the auth surface and they review as one unit.

**Files:**
- Modify: `c2c-e-commerce/src/lib/oauth/return-to.ts:28`
- Modify: `c2c-e-commerce/src/lib/oauth/return-to.test.ts`
- Modify: the two optional-auth routes using `catch {}` (located in Step 1)
- Modify: `c2c-e-commerce/src/app/api/auth/login/route.ts:131`
- Create: `c2c-e-commerce/src/app/api/auth/providers/route.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Locate the two `catch {}` routes**

```bash
cd c2c-e-commerce && grep -rn "catch {}" src/app/api/
```

Record the two files this reports. A third optional-auth route handles the same situation correctly and is the pattern to copy; find it with:

```bash
cd c2c-e-commerce && grep -rln "authenticate" src/app/api/ | xargs grep -ln "AuthError"
```

- [ ] **Step 2: Write the failing tests**

Append to `c2c-e-commerce/src/lib/oauth/return-to.test.ts`:

```ts
describe("safeReturnTo character handling", () => {
  // The predicate is `/[ -\s]/`, which parses as the three-member set {space, literal
  // hyphen, whitespace} -- not the "space through whitespace" range its comment
  // describes. So it rejects ordinary paths containing a hyphen and admits several
  // control characters. It fails closed, so this is hygiene rather than a hole -- but the
  // existing tests cover only tab and newline, which the pattern matches either way, so
  // they do not demonstrate what they claim.
  it("accepts an ordinary path containing a hyphen", () => {
    expect(safeReturnTo("/link-account")).toBe("/link-account");
    expect(safeReturnTo("/listings/new-item")).toBe("/listings/new-item");
  });

  it.each([
    ["null", "/a\u0000b"],
    ["bell", "/a\u0007b"],
    ["backspace", "/a\u0008b"],
    ["vertical tab", "/a\u000bb"],
    ["escape", "/a\u001bb"],
    ["delete", "/a\u007fb"],
    ["line separator", "/a\u2028b"],
  ])("rejects a path containing %s", (_label, candidate) => {
    expect(safeReturnTo(candidate)).toBe("/");
  });
});
```

Create `c2c-e-commerce/src/app/api/auth/providers/route.test.ts` — the only route in the app with no test at all. Read the route first and assert its real shape:

```ts
import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/auth/providers/route";

describe("GET /api/auth/providers", () => {
  it("lists the configured providers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("never includes a client secret", async () => {
    const body = await (await GET()).json();
    // Whatever the shape, no secret may appear anywhere in it. Serialising the whole body
    // catches a secret nested somewhere a field-by-field assertion would miss.
    expect(JSON.stringify(body)).not.toMatch(/secret/i);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/oauth/return-to.test.ts src/app/api/auth/providers/route.test.ts
```

Expected: FAIL — `/link-account` is rejected, several control characters are accepted, and the providers test file is new.

- [ ] **Step 4: Write the implementations**

In `return-to.ts:28`, replace the character predicate with one that says what it means:

```ts
// Control characters and Unicode line terminators -- what the old `/[ -\s]/` was trying
// to express. That pattern actually parses as {space, literal hyphen, whitespace}, so it
// rejected `/link-account` and let several control characters through. Header and URL
// parsers disagree about these characters, which is what makes them useful for smuggling.
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
```

Keep every other guard in the function unchanged — this replaces one predicate, not the function.

In each of the two `catch {}` routes:

```ts
    } catch (err) {
      // Only a failed authentication means "anonymous visitor". A missing JWT_SECRET or
      // any other fault is a server problem, and swallowing it here served every caller a
      // logged-out view of a broken deployment.
      if (!(err instanceof AuthError)) throw err;
    }
```

In `login/route.ts:131`:

```ts
    // The message only: the driver's error object carries the bound parameters, and the
    // submitted email is one of them.
    console.error("[POST /api/auth/login]", err instanceof Error ? err.message : err);
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/oauth/return-to.test.ts src/app/api/auth/providers/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src
git commit -m "fix(auth): make safeReturnTo's predicate match its comment; stop swallowing config errors

The old pattern parsed as {space, hyphen, whitespace}, so it rejected
/link-account and admitted several control characters. The catch {} blocks
read a missing JWT_SECRET as an anonymous visitor. And login's 500 handler
logged the driver error, which carries the submitted email."
```

---

## Task 13: Listing deletion soft-deletes when order history exists

**Files:**
- Modify: `c2c-e-commerce/src/app/api/listings/[id]/route.ts:430-480` (the `DELETE` handler)
- Create: `c2c-e-commerce/src/app/api/listings/[id]/delete-with-orders.integration.test.ts`

**Interfaces:**
- Consumes: `listImagesFor` (`src/db/listing-images.ts`), `getStorageProvider` (`src/lib/storage.ts`).
- Produces: nothing.

The Critical. `db.delete(listings)` runs with nothing catching the `RESTRICT` foreign key on `orders.listing_id`, so one cancelled order makes a listing permanently undeletable behind an opaque 500.

Per D7 the answer is not a 409. `PUBLIC_LISTING_STATUSES` is already `["active", "reserved", "sold"]`, so setting `removed` takes the listing out of every public read path — which is what the seller actually wants — while leaving the buyer's order history intact.

- [ ] **Step 1: Write the failing test**

Create `c2c-e-commerce/src/app/api/listings/[id]/delete-with-orders.integration.test.ts`. Reuse the seeding helpers from the neighbouring `delete-storage.integration.test.ts`:

```ts
/**
 * `orders.listing_id` is RESTRICT, so deleting a listing that any order references used
 * to hit the constraint and surface as an opaque 500 -- one cancelled order was enough to
 * make a listing permanently undeletable.
 *
 * Withdrawing it instead is what the seller wanted anyway: `removed` is outside
 * PUBLIC_LISTING_STATUSES, so the listing leaves every public read path while the buyer's
 * order keeps pointing at something real.
 */
import { describe, expect, it } from "vitest";

import { DELETE } from "@/app/api/listings/[id]/route";
import { db } from "@/db";
import { listingImages, listings } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("DELETE /api/listings/[id] with order history", () => {
  it("withdraws rather than deletes when an order references the listing", async () => {
    const { listing, sellerToken } = await seedListingWithCancelledOrder();

    const response = await DELETE(authed(sellerToken), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(200);

    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row).toBeDefined();
    expect(row.status).toBe("removed");
  });

  it("keeps the images of a withdrawn listing", async () => {
    // The listing row still exists and the buyer's order still links to it, so cleaning
    // up its objects would leave the order pointing at a listing with no photos.
    const { listing, sellerToken } = await seedListingWithCancelledOrder({ images: 2 });

    await DELETE(authed(sellerToken), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    const images = await db
      .select()
      .from(listingImages)
      .where(eq(listingImages.listingId, listing.id));
    expect(images).toHaveLength(2);
  });

  it("hides a withdrawn listing from the public detail route", async () => {
    const { listing, sellerToken } = await seedListingWithCancelledOrder();

    await DELETE(authed(sellerToken), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    const anonymous = await GET(new NextRequest(`http://test/api/listings/${listing.id}`), {
      params: Promise.resolve({ id: String(listing.id) }),
    });
    expect(anonymous.status).toBe(404);
  });

  it("still hard-deletes a listing no order references", async () => {
    // The positive control. Without it, a handler that withdrew *everything* would pass
    // every assertion above while quietly abandoning real deletion.
    const { listing, sellerToken } = await seedListingWithoutOrders();

    const response = await DELETE(authed(sellerToken), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(200);
    expect(await db.select().from(listings).where(eq(listings.id, listing.id))).toHaveLength(0);
  });

  it("removes the storage objects of a hard-deleted listing", async () => {
    const { listing, sellerToken, storageKeys } = await seedListingWithoutOrders({ images: 2 });

    await DELETE(authed(sellerToken), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    for (const key of storageKeys) {
      expect(await getStorageProvider().get(key)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/listings/[id]/delete-with-orders.integration.test.ts"
```

Expected: FAIL — the withdraw cases return 500 from the foreign key.

- [ ] **Step 3: Write the implementation**

Replace the delete section of the `DELETE` handler (after the `canMutateListing` check):

```ts
    // `orders.listing_id` is RESTRICT, and rightly so: an order that pointed at nothing
    // would be a receipt for a purchase the system could no longer describe. So a listing
    // with history is withdrawn rather than deleted.
    //
    // `removed` is outside PUBLIC_LISTING_STATUSES, so this takes the listing out of
    // browse, search and the public detail route -- which is what the seller asked for --
    // while the buyer's order keeps pointing at something real.
    const [referencingOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.listingId, id))
      .limit(1);

    if (referencingOrder) {
      await db
        .update(listings)
        .set({ status: "removed" })
        .where(eq(listings.id, id));

      // The images stay. The row still exists and an order still links to it, so removing
      // its objects would leave that order pointing at a listing with no photos.
      return jsonOk({
        message:
          "Listing withdrawn. It is no longer visible to buyers, but it cannot be deleted outright because it has order history.",
        status: "removed",
      });
    }

    // Read the image rows *before* the delete: migration 0012's ON DELETE CASCADE takes
    // listing_images (and with it, the only record of the storage keys) down with the
    // listing row. After the cascade nothing can enumerate the orphaned objects.
    const images = await listImagesFor(id);

    await db.delete(listings).where(eq(listings.id, id));

    // Row first, object second, same as DELETE /api/listings/[id]/images/[imageId]:
    // best-effort cleanup that must not fail a request the row-delete already succeeded.
    for (const image of images) {
      try {
        await getStorageProvider().delete(image.storageKey);
      } catch (err) {
        if (!(err instanceof StorageError)) throw err;
        console.error("[DELETE /api/listings/[id]] object left behind", image.storageKey, err);
      }
    }

    return jsonOk({ message: "Listing deleted successfully", status: "deleted" });
```

Import `orders` from `@/db/schema`.

- [ ] **Step 4: Update the Swagger block**

The route's JSDoc documents a single 200. Add the withdrawn case to its description and note that the response body carries `status: "removed" | "deleted"`, so a client can tell which happened.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/listings/[id]"
```

Expected: PASS, including the existing delete-storage suite unchanged.

- [ ] **Step 6: Deliberate break**

Temporarily remove the `if (referencingOrder)` branch so every delete is a hard delete. Re-run.

Expected: FAIL on **"withdraws rather than deletes when an order references the listing"**, by name, with a 500. Restore.

- [ ] **Step 7: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src
git commit -m "fix(listings): withdraw a listing with order history instead of 500ing

One cancelled order was enough to make a listing permanently undeletable
behind an opaque 500, because orders.listing_id is RESTRICT. It now moves
to `removed` -- already outside PUBLIC_LISTING_STATUSES, so it leaves every
public read path -- and the buyer's order keeps pointing at something real."
```

---

## Task 14: `/similar` stops leaking draft content

**Files:**
- Modify: `c2c-e-commerce/src/app/api/listings/[id]/similar/route.ts:92-107`
- Modify: `c2c-e-commerce/src/app/api/listings/[id]/similar/route.integration.test.ts`

**Interfaces:**
- Consumes: `isPubliclyVisible` (`src/lib/listing-visibility.ts`), `authenticateOptional` — whichever helper the neighbouring public routes use for optional auth; read `src/app/api/images/[id]/route.ts` and copy its approach exactly.
- Produces: nothing.

The route never checks the source listing's status. A stranger gets 404 for a non-existent id but 200 with neighbours for a draft — confirming it exists and disclosing what it is about through its nearest neighbours. This contradicts the RBAC matrix, which lists `/similar` as flatly public while also claiming `draft` and `removed` are owner-or-admin.

- [ ] **Step 1: Write the failing test**

Append to `c2c-e-commerce/src/app/api/listings/[id]/similar/route.integration.test.ts`:

```ts
describe("draft visibility", () => {
  // A 200 with neighbours confirms the listing exists and describes what it is about
  // through the things nearest it in vector space -- for a listing its owner has not
  // published.
  it("answers 404 for a stranger asking about a draft", async () => {
    const { listing } = await seedListing({ status: "draft" });

    const response = await GET(new NextRequest("http://test/api/listings/1/similar"), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(404);
  });

  it("answers 404 for a signed-in stranger too", async () => {
    const { listing } = await seedListing({ status: "draft" });
    const { token } = await seedUser();

    const response = await GET(authed(token), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(404);
  });

  it("serves the owner their own draft's neighbours", async () => {
    // The positive control: a handler that 404s on every draft would pass both
    // assertions above while breaking the feature for the person it belongs to.
    const { listing, sellerToken } = await seedListing({ status: "draft" });

    const response = await GET(authed(sellerToken), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(200);
  });

  it("serves an admin the same", async () => {
    const { listing } = await seedListing({ status: "draft" });
    const admin = await seedAdmin();

    const response = await GET(authed(admin.token), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(200);
  });

  it("still serves a published listing to anyone", async () => {
    const { listing } = await seedListing({ status: "active" });

    const response = await GET(new NextRequest("http://test/api/listings/1/similar"), {
      params: Promise.resolve({ id: String(listing.id) }),
    });

    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/listings/[id]/similar"
```

Expected: FAIL — both stranger cases return 200.

- [ ] **Step 3: Write the implementation**

Add `sellerId` and `status` to the source select, then gate on them exactly as `/api/images/{id}` does:

```ts
    const [source] = await db
      .select({
        id: listings.id,
        sellerId: listings.sellerId,
        status: listings.status,
        categoryId: listings.categoryId,
        embedding: listings.embedding,
      })
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!source) return jsonError("Listing not found", 404);

    // A draft's neighbours describe the draft. Answering 200 here confirmed the listing
    // existed and disclosed what it was about through the things nearest it in vector
    // space -- for a listing its owner had not published. Same rule and same 404 as
    // GET /api/images/{id}, so the two cannot drift apart.
    const viewer = optionalAuth(request);
    const mayRead =
      isPubliclyVisible(source.status) ||
      viewer?.role === "admin" ||
      viewer?.sub === source.sellerId;

    if (!mayRead) return jsonError("Listing not found", 404);
```

Use whatever optional-authentication helper `/api/images/{id}` uses, with the same name — do not introduce a second spelling of the same idea.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/listings/[id]/similar"
```

Expected: PASS.

- [ ] **Step 5: Deliberate break**

Temporarily replace `mayRead` with `true`. Re-run.

Expected: FAIL on **"answers 404 for a stranger asking about a draft"** and **"answers 404 for a signed-in stranger too"**, by name. Restore.

- [ ] **Step 6: Commit**

```bash
git add c2c-e-commerce/src
git commit -m "fix(sec): stop /similar disclosing a draft through its neighbours"
```

---

## Task 15: Order lifecycle — expiry guard and sold-listing release

**Files:**
- Modify: `c2c-e-commerce/src/app/api/orders/[id]/route.ts` (the transition, around `:252-262`)
- Modify: `c2c-e-commerce/src/db/orders.ts` (`transitionOrder` gains an expiry condition; `releaseUnheldListings:86-103`)
- Modify: `c2c-e-commerce/src/db/orders.integration.test.ts`
- Create: `c2c-e-commerce/src/app/api/orders/[id]/expiry.integration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `transitionOrder` gains a `requireUnexpired: boolean` parameter (or an equivalent internal condition — keep the exported signature backward compatible for its other caller).

Two lifecycle defects, both in the same pair of files.

`expires_at` appears in no comparison on the transition path, so a seller can confirm an order that lapsed a week ago — and whether they can depends entirely on whether the scheduled sweep has run, which contradicts the redesign spec's own claim that correctness does not depend on the sweep.

`releaseUnheldListings` only touches listings in `reserved`, so deleting a confirmed order leaves its listing `sold` forever: permanently unbuyable, with no order left to explain why.

- [ ] **Step 1: Write the failing tests**

Create `c2c-e-commerce/src/app/api/orders/[id]/expiry.integration.test.ts`:

```ts
/**
 * D4 of the redesign spec says correctness must not depend on the sweep having run. It
 * did: `expires_at` was in no comparison on the transition path, so whether a lapsed
 * reservation could still be confirmed came down to timing.
 */
import { describe, expect, it } from "vitest";

describe("confirming a lapsed reservation", () => {
  it("is refused even though the sweep has not run", async () => {
    // Seeded already expired, and deliberately *without* invoking the expiry sweep.
    const { order, sellerToken } = await seedPendingOrder({ expiresAt: hoursAgo(1) });

    const response = await PUT(authed(sellerToken, { status: "confirmed" }), {
      params: Promise.resolve({ id: String(order.id) }),
    });

    expect(response.status).toBe(409);
  });

  it("still confirms an order inside its window", async () => {
    // Positive control: a guard that refused every confirmation would pass the assertion
    // above while breaking the seller's only way to accept a sale.
    const { order, sellerToken } = await seedPendingOrder({ expiresAt: hoursFromNow(24) });

    const response = await PUT(authed(sellerToken, { status: "confirmed" }), {
      params: Promise.resolve({ id: String(order.id) }),
    });

    expect(response.status).toBe(200);
  });

  it("still lets a lapsed order be declined or cancelled", async () => {
    // Expiry blocks the sale, not the tidy-up. Refusing every transition would strand the
    // order in a status nobody can leave.
    const { order, sellerToken } = await seedPendingOrder({ expiresAt: hoursAgo(1) });

    const response = await PUT(authed(sellerToken, { status: "declined" }), {
      params: Promise.resolve({ id: String(order.id) }),
    });

    expect(response.status).toBe(200);
  });
});
```

Append to `c2c-e-commerce/src/db/orders.integration.test.ts`:

```ts
describe("releaseUnheldListings and sold listings", () => {
  it("returns a sold listing to active when its order is deleted", async () => {
    // Only `reserved` was released, so deleting a confirmed order left the listing sold
    // forever: unbuyable, with no order left to explain why.
    const { listing, order } = await seedConfirmedOrder();
    expect(await statusOf(listing.id)).toBe("sold");

    await deleteOrder(order.id);
    await releaseUnheldListings(db, listing.id);

    expect(await statusOf(listing.id)).toBe("active");
  });

  it("leaves a sold listing alone while a live order still holds it", async () => {
    // The guard that keeps this from becoming "any sold listing goes back on sale".
    const { listing } = await seedConfirmedOrder();

    await releaseUnheldListings(db, listing.id);

    expect(await statusOf(listing.id)).toBe("sold");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/orders/[id]/expiry.integration.test.ts" src/db/orders.integration.test.ts
```

Expected: FAIL — the lapsed order confirms with 200, and the sold listing stays sold.

- [ ] **Step 3: Write the implementations**

In `src/db/orders.ts`, add the expiry condition to the conditional update that claims the transition. The compare-and-set already guarantees only one caller wins; this adds "and it has not lapsed" to the same statement, so it holds without a separate read:

```ts
    -- ... existing WHERE "id" = ${id} AND "status" = ${from}
       AND ("expires_at" IS NULL OR "expires_at" > now())
```

Apply it **only** when the target status is `confirmed`. Expiry blocks the sale, not the tidy-up: refusing a decline or a cancellation on a lapsed order would strand it in a status nobody can leave. Thread this through as an explicit parameter rather than inferring it inside the query, so the rule is visible at the call site.

Widen `releaseUnheldListings`:

```ts
  const result = await x.execute(sql`
    UPDATE "listings" SET "status" = 'active'
     WHERE "status" IN ('reserved', 'sold')${scope}
       AND NOT EXISTS (
         SELECT 1 FROM "orders"
          WHERE "orders"."listing_id" = "listings"."id"
            AND "orders"."status" IN ('pending', 'confirmed')
       )
     RETURNING "id"
  `);
```

Update the function's doc comment: it now releases a listing whose *confirmed* order was deleted as well as one whose pending order was, and the "no live order" test covers both statuses rather than only `pending`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/orders" src/db/orders.integration.test.ts
```

Expected: PASS, including the existing order-lifecycle suites.

- [ ] **Step 5: Deliberate break**

Temporarily remove the `expires_at` condition. Re-run.

Expected: FAIL on **"is refused even though the sweep has not run"**, by name. Then restore it and temporarily narrow `releaseUnheldListings` back to `'reserved'` only; expect FAIL on **"returns a sold listing to active when its order is deleted"**. Restore both.

- [ ] **Step 6: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src
git commit -m "fix(orders): refuse to confirm a lapsed reservation; release stranded sold listings

Whether a week-old reservation could still be confirmed depended on
whether the sweep had run, which is exactly what D4 says must not be true.
And deleting a confirmed order left its listing sold forever -- unbuyable,
with no order left to explain why."
```

---

## Task 16: Category tree guards inside the transaction

**Files:**
- Modify: `c2c-e-commerce/src/app/api/categories/[id]/route.ts:146-190`
- Create: `c2c-e-commerce/src/app/api/categories/concurrent-move.integration.test.ts`

**Interfaces:**
- Consumes: `findCategoryById`, `wouldCreateCycle`, `subtreeHeight`, `hasListings` — each gains an executor parameter so it can run inside the transaction, following the `OrderExecutor` pattern in `src/db/orders.ts`.
- Produces: nothing.

`wouldCreateCycle`, `subtreeHeight` and `hasListings` all run on the module-level client *before* the transaction opens. Two concurrent admin moves can each pass against stale paths and produce a cycle the database has no constraint against — and a cycle in a materialised-path tree makes every descendant query non-terminating or wrong.

- [ ] **Step 1: Write the failing test**

Create `c2c-e-commerce/src/app/api/categories/concurrent-move.integration.test.ts`:

```ts
/**
 * The three guards read on the module client before the transaction opened, so two
 * simultaneous moves each validated against paths the other was about to invalidate. A
 * cycle in a materialised-path tree is not a cosmetic problem: descendant queries stop
 * terminating, and there is no constraint that would have caught it.
 */
import { describe, expect, it } from "vitest";

describe("concurrent category moves", () => {
  it("cannot produce a cycle", async () => {
    // A and B are siblings. Moving A under B and B under A are each individually legal
    // against the tree as it stands; together they are a cycle.
    const { a, b, adminToken } = await seedTwoRootCategories();

    await Promise.allSettled([
      PATCH(authed(adminToken, { parentId: b.id }), {
        params: Promise.resolve({ id: String(a.id) }),
      }),
      PATCH(authed(adminToken, { parentId: a.id }), {
        params: Promise.resolve({ id: String(b.id) }),
      }),
    ]);

    // Exactly one may have succeeded. Whichever it was, neither node may end up inside
    // the other's subtree in both directions.
    const [rowA, rowB] = await Promise.all([findCategoryById(a.id), findCategoryById(b.id)]);

    const aUnderB = rowA!.path.startsWith(rowB!.path);
    const bUnderA = rowB!.path.startsWith(rowA!.path);
    expect(aUnderB && bUnderA).toBe(false);
  });

  it("still performs a single legal move", async () => {
    // Positive control: a handler that refused every move would pass the assertion above.
    const { a, b, adminToken } = await seedTwoRootCategories();

    const response = await PATCH(authed(adminToken, { parentId: b.id }), {
      params: Promise.resolve({ id: String(a.id) }),
    });

    expect(response.status).toBe(200);
    expect((await findCategoryById(a.id))!.parentId).toBe(b.id);
  });
});
```

This file calls `PATCH`, which Task 18 introduces. Executing in numeric order, write it against `PUT` and let Task 18 rename it along with the handler.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project integration src/app/api/categories/concurrent-move.integration.test.ts
```

Expected: FAIL on **"cannot produce a cycle"** — both moves commit and each node ends up inside the other's path.

If it passes on the first run, the interleaving did not occur: the two requests were serialised by chance. Do not accept that as a pass — add a barrier so both handlers reach their guards before either commits, or run the pair in a loop of ten iterations, before continuing.

- [ ] **Step 3: Write the implementation**

Move the whole `parentId` validation block inside the transaction and lock both nodes before reading anything:

```ts
    const updated = await db.transaction(async (tx) => {
      // Lock the node and its prospective parent before any guard reads a path. The three
      // checks below are only meaningful against a tree that cannot change underneath
      // them, and a cycle is not something the schema can refuse on their behalf.
      //
      // Ordered by id so two concurrent moves of the same pair take the locks in the same
      // sequence and one waits rather than both deadlocking.
      const lockIds = [id, parentId].filter((value): value is number => value !== null && value !== undefined)
        .sort((a, b) => a - b);

      await tx
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.id, lockIds))
        .for("update");

      // ... the existing parentId guards, each now taking `tx`
    });
```

Give `findCategoryById`, `wouldCreateCycle`, `subtreeHeight` and `hasListings` an executor parameter defaulting to the module `db`, and pass `tx` at each of these call sites. Every early `return jsonError(...)` inside the block becomes a thrown typed error caught outside the transaction and mapped to the same status and message it returns today — a `return` inside a transaction callback commits it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project integration src/app/api/categories/
```

Expected: PASS, including the existing category suites and every guard's original status code.

- [ ] **Step 5: Deliberate break**

Temporarily remove the `.for("update")` lock. Re-run.

Expected: FAIL on **"cannot produce a cycle"**, by name. Restore.

- [ ] **Step 6: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src
git commit -m "fix(categories): take the tree guards inside the transaction under a row lock

The cycle, depth and has-listings checks read on the module client before
the transaction opened, so two simultaneous moves each validated against
paths the other was about to invalidate."
```

---

## Task 17: Pagination — tiebreaker and admin collections

**Files:**
- Modify: `c2c-e-commerce/src/lib/listings-query.ts:200-213` (every `orderBy` branch)
- Modify: `c2c-e-commerce/src/app/api/orders/route.ts:68-74`
- Modify: `c2c-e-commerce/src/app/api/orders/seller/route.ts:89-107`
- Modify: `c2c-e-commerce/src/app/api/users/route.ts:46-53`
- Modify: `c2c-e-commerce/src/lib/listings-query.test.ts`
- Create: `c2c-e-commerce/src/app/api/pagination.integration.test.ts`

**Interfaces:**
- Consumes: `parseBoundedInt` (Task 6).
- Produces: nothing.

Ordering by `createdAt` or `price` with no `id` tiebreaker means two rows sharing a value can shuffle between requests, so a listing falls through the gap between pages or appears on both. `orders/seller` and `users/{id}/reviews` both already add one explicitly for this reason.

Separately, `GET /api/orders`, `GET /api/orders/seller` and `GET /api/users` have no `page` or `limit` at all and return whole tables.

- [ ] **Step 1: Read the envelope you are matching**

```bash
cd c2c-e-commerce && grep -n "totalPages\|total\|page\|limit" src/app/api/listings/route.ts | head -20
```

Record the exact response shape `GET /api/listings` returns. The three collections below must use that shape byte for byte — a fourth envelope is what this finding is about.

- [ ] **Step 2: Write the failing tests**

Append to `c2c-e-commerce/src/lib/listings-query.test.ts`:

```ts
describe("ordering is total", () => {
  // Without a tiebreaker, two listings sharing a createdAt (or a price, under
  // sort=price_asc) can swap places between two requests -- so a row falls into the gap
  // between page 1 and page 2, or is served on both.
  it.each(["newest", "oldest", "price_asc", "price_desc"])(
    "breaks ties by id under sort=%s",
    (sort) => {
      const built = buildListingQuery(new URLSearchParams({ sort }), null);
      expect(built.ok).toBe(true);
      // Two order terms, the second of which is the primary key.
      expect(JSON.stringify(built.ok && built.query.orderBy)).toMatch(/"id"/);
    },
  );
});
```

Create `c2c-e-commerce/src/app/api/pagination.integration.test.ts`:

```ts
/**
 * Three admin collections returned whole tables, while two sibling collections paginated
 * properly. And browse ordering had no tiebreaker, so a row could fall between pages.
 */
import { describe, expect, it } from "vitest";

describe("admin collections paginate", () => {
  it.each([
    ["GET /api/orders", ordersGet],
    ["GET /api/orders/seller", sellerOrdersGet],
    ["GET /api/users", usersGet],
  ])("%s honours page and limit", async (_label, call) => {
    const { adminToken } = await seedAdminWith(25, "rows");

    const first = await (await call(adminToken, { page: 1, limit: 10 })).json();
    const second = await (await call(adminToken, { page: 2, limit: 10 })).json();

    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(10);
    expect(first.total).toBe(25);
    expect(first.totalPages).toBe(3);

    // No row may appear on both pages.
    const firstIds = new Set(first.data.map((row: { id: number }) => row.id));
    expect(second.data.some((row: { id: number }) => firstIds.has(row.id))).toBe(false);
  });
});

describe("browse pagination is stable", () => {
  it("serves every listing exactly once across pages when timestamps collide", async () => {
    // All 15 share one createdAt, which is the case the missing tiebreaker broke.
    await seedListingsSharingATimestamp(15);

    const seen: number[] = [];
    for (const page of [1, 2, 3]) {
      const body = await (await listingsGet({ page, limit: 5, sort: "newest" })).json();
      seen.push(...body.data.map((row: { id: number }) => row.id));
    }

    expect(new Set(seen).size).toBe(15);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/listings-query.test.ts
cd c2c-e-commerce && npx vitest run --project integration src/app/api/pagination.integration.test.ts
```

Expected: FAIL — no `id` term in the ordering, and the three collections ignore `page` entirely.

- [ ] **Step 4: Write the implementation**

In `listings-query.ts`, append the primary key to every branch:

```ts
  // Every branch ends in the primary key. Ordering by a non-unique column alone is not a
  // total order, so two rows sharing a createdAt -- or a price, under price_asc -- can
  // swap between requests, and a row then falls into the gap between two pages or is
  // served on both. `orders/seller` and `users/{id}/reviews` already do this.
  const orderBy =
    sortParam === "oldest"
      ? [asc(listings.createdAt), asc(listings.id)]
      : sortParam === "price_asc"
        ? [asc(listings.price), asc(listings.id)]
        : sortParam === "price_desc"
          ? [desc(listings.price), desc(listings.id)]
          : [desc(listings.createdAt), desc(listings.id)];
```

Adjust the consuming query to spread an array into `.orderBy(...)` if it does not already.

For each of the three collections, add `page` and `limit` through `parseBoundedInt` and return the same envelope `GET /api/listings` uses, with a `count(*)` for the total and an `id` tiebreaker on the ordering. `GET /api/orders`:

```ts
    const page = parseBoundedInt(request.nextUrl.searchParams.get("page"), {
      fallback: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const limit = parseBoundedInt(request.nextUrl.searchParams.get("limit"), {
      fallback: 20,
      max: 100,
    });

    const scope = payload.role === "admin" ? undefined : eq(orders.buyerId, payload.sub);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .where(scope);

    const rows = await db
      .select()
      .from(orders)
      .where(scope)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit)
      .offset((page - 1) * limit);

    return jsonOk({ data: rows, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
```

Apply the same shape to `orders/seller/route.ts` and `users/route.ts`, keeping each route's existing authorisation and scoping untouched.

- [ ] **Step 5: Update the Swagger blocks and the frontend callers**

Each of the three routes now returns an envelope rather than a bare array. Update their JSDoc, and update any frontend code reading them as arrays:

```bash
cd c2c-e-commerce && grep -rn "api/orders\"\|api/orders'\|api/users\"\|api/orders/seller" "src/app/(frontend)" src/components src/hooks
```

Each such call site becomes `response.data`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/lib/listings-query.test.ts
cd c2c-e-commerce && npx vitest run --project integration src/app/api/pagination.integration.test.ts
cd c2c-e-commerce && npx tsc --noEmit
```

Expected: PASS, `tsc` clean.

- [ ] **Step 7: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src
git commit -m "fix(api): total ordering on browse, and pagination on three admin collections

Ordering by createdAt or price alone is not a total order, so a row could
fall into the gap between pages or be served on both. And three
collections returned whole tables while two siblings paginated properly."
```

---

## Task 18: PUT becomes PATCH for partial updates

**Files:**
- Modify: `c2c-e-commerce/src/app/api/categories/[id]/route.ts:106`
- Modify: `c2c-e-commerce/src/app/api/listings/[id]/route.ts:250`
- Modify: `c2c-e-commerce/src/app/api/users/[id]/route.ts:181`
- Modify: every integration test calling those three handlers
- Modify: the frontend call sites (per D10)

**Interfaces:**
- Consumes: nothing.
- Produces: the three handlers are exported as `PATCH` rather than `PUT`. `reviews/[id]` is already `PATCH` and does not change.

All four routes accept "at least one field", but three are `PUT` and one is `PATCH`. A client cannot infer from the verb whether a full or partial body is expected and has to remember per resource.

No dual-verb transition period: there are no external clients, and supporting both would be YAGNI. Per D10 the frontend call sites change in this commit, so the tree is never broken at a task boundary.

- [ ] **Step 1: Find every caller**

```bash
cd c2c-e-commerce && grep -rn "api.put\|\"PUT\"\|method: \"PUT\"" src/ | grep -v node_modules
```

Record every hit. Frontend call sites use `api.put`; integration tests import the `PUT` handler directly.

- [ ] **Step 2: Rename the handlers**

In each of the three route files, rename the exported function from `PUT` to `PATCH` and update the `console.error` tag in its catch block (`"[PUT /api/users/[id]]"` becomes `"[PATCH /api/users/[id]]"`). Update the JSDoc block above each: the OpenAPI path item key changes from `put:` to `patch:`.

- [ ] **Step 3: Update every caller**

Integration tests: change `import { PUT }` to `import { PATCH }` and every call. This includes the files Tasks 11 and 16 created against `PUT`.

Frontend: change `api.put(...)` to `api.patch(...)` at each site found in Step 1. `api.patch` already exists in `src/lib/api.ts:137`.

- [ ] **Step 4: Verify nothing was missed**

```bash
cd c2c-e-commerce && npx tsc --noEmit
cd c2c-e-commerce && grep -rn "api.put" src/ || echo "no remaining api.put callers"
```

Expected: `tsc` clean, and no remaining `api.put`. A missed route handler is not a type error — Next simply stops routing that verb — so also confirm each of the three files exports `PATCH` and no longer exports `PUT`:

```bash
cd c2c-e-commerce && grep -n "export async function P" "src/app/api/categories/[id]/route.ts" "src/app/api/listings/[id]/route.ts" "src/app/api/users/[id]/route.ts"
```

Expected: `PATCH` and `DELETE`/`GET` only — no `PUT`.

- [ ] **Step 5: Regenerate the Swagger spec**

```bash
cd c2c-e-commerce && node scripts/generate-swagger.mjs
cd c2c-e-commerce && grep -c "\"put\"" src/lib/swagger-spec.json
```

Expected: `0` — no path item should still document a `put` operation.

- [ ] **Step 6: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce/src
git commit -m "refactor(api): PATCH for partial updates on categories, listings and users

All four of these routes accept 'at least one field'; three said PUT and
one said PATCH, so a client had to remember which per resource. Frontend
call sites move in the same commit -- there are no external clients, so a
dual-verb transition period would be YAGNI."
```

---

## Task 19: Conflict status and Location headers

**Files:**
- Modify: `c2c-e-commerce/src/app/api/orders/[id]/route.ts:252`
- Modify: `c2c-e-commerce/src/app/api/orders/[id]/route.integration.test.ts` (and any other test asserting 400 for an illegal transition)
- Modify: every route returning 201 — `listings`, `orders`, `categories`, `listings/[id]/images`, `orders/[id]/review`, `auth/register`
- Modify: `c2c-e-commerce/src/lib/response.ts` (optional headers on `jsonOk`, if it does not already accept them)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

An illegal lifecycle transition returns 400 while two sibling conflicts in the same handler return 409. It is a conflict with the resource's current state, not a malformed request — the body parsed fine.

- [ ] **Step 1: Write the failing test**

Append to `c2c-e-commerce/src/app/api/orders/[id]/route.integration.test.ts`:

```ts
it("answers 409, not 400, for a transition the graph forbids", async () => {
  // The body is well-formed and the status is a real one; what is wrong is the *state*.
  // Its two siblings in this same handler -- "already moved to another status" and "no
  // longer available to sell" -- already answer 409.
  const { order, buyerToken } = await seedCompletedOrder();

  const response = await PUT(authed(buyerToken, { status: "confirmed" }), {
    params: Promise.resolve({ id: String(order.id) }),
  });

  expect(response.status).toBe(409);
});

it("still answers 400 for a status that is not in the enum at all", async () => {
  // The distinction being drawn: a malformed body is still a 400.
  const { order, buyerToken } = await seedPendingOrder();

  const response = await PUT(authed(buyerToken, { status: "teleported" }), {
    params: Promise.resolve({ id: String(order.id) }),
  });

  expect(response.status).toBe(400);
});
```

Search for existing assertions of 400 on this path and update them:

```bash
cd c2c-e-commerce && grep -rn "Cannot move an order from" src/
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/orders/[id]/route.integration.test.ts"
```

Expected: FAIL — 400 where 409 is expected.

- [ ] **Step 3: Write the implementation**

```ts
    if (!canTransition(order.status, status, actor)) {
      // 409, not 400: the body parsed and the status is a real one. What is wrong is the
      // resource's current state, which is what 409 means -- and the two sibling
      // conflicts in this handler already say so.
      return jsonError(`Cannot move an order from ${order.status} to ${status}`, 409);
    }
```

Then add a `Location` header to every 201. If `jsonOk` does not already accept headers, give it an optional third parameter mirroring `jsonError`'s, and pass the created resource's canonical path:

```ts
    return jsonOk(created, 201, { Location: `/api/listings/${created.id}` });
```

Do this for each create route found with:

```bash
cd c2c-e-commerce && grep -rn ", 201)" src/app/api/
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project integration "src/app/api/orders"
```

Expected: PASS.

- [ ] **Step 5: Regenerate Swagger and run the full suite**

```bash
cd c2c-e-commerce && node scripts/generate-swagger.mjs
cd c2c-e-commerce && npm test
```

Update the JSDoc for the transition route so its documented 400 becomes 409.

- [ ] **Step 6: Commit**

```bash
git add c2c-e-commerce/src
git commit -m "fix(api): 409 for an illegal transition, Location on every 201"
```

---

## Task 20: Response headers and compose hardening

**Files:**
- Modify: `c2c-e-commerce/next.config.ts`
- Modify: `docker-compose.yml`
- Modify: `README.md` and the env example (document `TRUSTED_PROXY_HOPS`)
- Create: `c2c-e-commerce/src/test/security-headers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `c2c-e-commerce/src/test/security-headers.test.ts`. Asserting against the config rather than a live server keeps this in the fast unit project, and the thing worth pinning is that the four controls are declared at all:

```ts
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("security response headers", () => {
  it("declares the four controls the threat model claims", async () => {
    const entries = await nextConfig.headers!();
    const applied = entries.flatMap((entry) => entry.headers.map((h) => h.key.toLowerCase()));

    expect(applied).toContain("strict-transport-security");
    expect(applied).toContain("referrer-policy");
    expect(applied).toContain("x-content-type-options");
    expect(applied).toContain("content-security-policy");
  });

  it("applies them to every route", async () => {
    const entries = await nextConfig.headers!();
    expect(entries.some((entry) => entry.source === "/:path*")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/test/security-headers.test.ts
```

Expected: FAIL — `nextConfig.headers` is undefined.

- [ ] **Step 3: Write the implementation**

In `c2c-e-commerce/next.config.ts`:

```ts
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // A year, with subdomains: anything shorter is advisory rather than a policy.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          // Send the full URL only same-origin. A listing URL carries an id, and the
          // referrer is the quietest way for it to reach a third party.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // frame-ancestors only. A full CSP needs a nonce strategy for Next's inline
          // scripts, which is its own piece of work (spec section 15); this is the part
          // that needs no strategy and stops the app being framed for clickjacking.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
```

In `docker-compose.yml`, the production file:

```yaml
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}
```

and delete the `ports:` block from the `db` service — `JWT_SECRET` in the same file already uses `:?`, and the weaker default was the one guarding the data. Leave `docker-compose.dev.yml` alone: publishing the port is what makes local work possible.

Document `TRUSTED_PROXY_HOPS` in the README beside the other environment variables, stating the default of `0`, that Railway needs `1`, and what `0` means for IP-keyed limits.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/test/security-headers.test.ts
cd c2c-e-commerce && npm run build
```

Expected: PASS, and the build succeeds — a malformed `headers()` fails there rather than at runtime.

- [ ] **Step 5: Commit**

```bash
git add c2c-e-commerce docker-compose.yml README.md
git commit -m "feat(sec): security response headers; fail fast on an unset DB password"
```

---

## Task 21: Make the security documents true

**Files:**
- Modify: `docs/security/threat-model.md` (T4, T7, and the section 4 limitations table)
- Modify: `docs/security/rbac-matrix.md` (the `/similar` row, the `/orders/seller` row)
- Modify: `c2c-e-commerce/src/test/threat-model.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

A document that overstates a protection is worse than no document: it is the one a reader trusts. Now that Tasks 3, 11, 12, 14 and 20 have closed the underlying gaps, the documents can describe what is true.

- [ ] **Step 1: Extend the test that pins the claims**

`src/test/threat-model.test.ts` already asserts these documents cite real files. Add assertions that pin the corrected claims themselves, so they cannot drift back:

```ts
describe("the threat model describes the limiter that exists", () => {
  it("names the trusted-hop model rather than implying raw XFF is trusted", () => {
    const t7 = sectionOf(threatModel, "T7");
    expect(t7).toMatch(/TRUSTED_PROXY_HOPS/);
    // The old text described sliding-window limits without mentioning that the key was
    // client-controlled. Naming the variable is what makes the claim checkable.
  });

  it("no longer lists the password-change gap as a limitation", () => {
    // Closed by the revocation in the password-change handler.
    expect(sectionOf(threatModel, "4")).not.toMatch(/refresh famil(y|ies) .* remain/i);
  });

  it("lists CSP as partially applied rather than absent", () => {
    expect(sectionOf(threatModel, "4")).toMatch(/frame-ancestors/);
  });
});

describe("the RBAC matrix matches the routes", () => {
  it("does not describe /similar as unconditionally public", () => {
    const row = rowFor(rbacMatrix, "/similar");
    expect(row).toMatch(/owner|admin/i);
  });

  it("records that /orders/seller projects the buyer's email", () => {
    expect(rowFor(rbacMatrix, "/orders/seller")).toMatch(/buyerEmail/);
  });
});
```

Build `sectionOf` and `rowFor` from whatever parsing the existing file already does — do not add a second way of reading these documents.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/test/threat-model.test.ts
```

Expected: FAIL on every new assertion.

- [ ] **Step 3: Correct the documents**

**T7** — rewrite to describe the limiter as it now is: keys derived from a trusted-hop count with `TRUSTED_PROXY_HOPS`, account-keyed limits alongside IP-keyed ones, per-bucket window sweeping. State the two real limitations plainly: state is per-instance and does not survive horizontal scaling, and with `TRUSTED_PROXY_HOPS=0` the IP-keyed limits are deliberately skipped so that account keys carry the protection.

**T4** — narrow the proof claim to the control-character coverage the predicate now actually has, and cite the tests Task 12 added rather than the two that matched under either pattern.

**Section 4 limitations** — remove the password-change gap (closed in Task 11); change "no CSP" to "CSP limited to `frame-ancestors`; a full policy needs a nonce strategy for Next's inline scripts"; add HSTS, `Referrer-Policy` and `X-Content-Type-Options` as applied.

**RBAC matrix** — the `/similar` row becomes owner-or-admin for non-public statuses, matching Task 14 and the matrix's own claim about `draft` and `removed`. The `/orders/seller` row records that the response projects `buyerEmail`, which a reader assessing exposure needs to know.

Add a short note to whichever document discusses migrations that `0013` dropped `image_url` without migrating it into `listing_images`, contrasted with `0015` and `0017`, which `RAISE NOTICE` before every deletion. It is applied and the data is gone, so this is a lesson recorded rather than a fix.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd c2c-e-commerce && npx vitest run --project unit src/test/threat-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs c2c-e-commerce/src
git commit -m "docs(security): make the threat model and RBAC matrix true

T7 described sliding-window limits without mentioning the key was
client-controlled; T4 claimed control-character coverage the predicate did
not have; the limitations table listed CSP as the only missing header
control and omitted that a password change left refresh families live. The
matrix listed /similar as flatly public while also claiming drafts are
owner-or-admin. A document that overstates a protection is worse than none."
```

---

## Task 22: Lint rules and a deterministic concurrency test

**Files:**
- Modify: `c2c-e-commerce/eslint.config.mjs`
- Modify: `c2c-e-commerce/src/db/orders.integration.test.ts:308`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Replace the fixed sleep**

`src/db/orders.integration.test.ts:308` uses a 250 ms sleep to order two concurrent operations — the same pattern already logged and replaced elsewhere in this suite. Find how the neighbouring concurrency test synchronises:

```bash
cd c2c-e-commerce && grep -rn "barrier\|Promise.withResolvers\|deferred" src/db/*.integration.test.ts src/test/
```

Replace the sleep with that same mechanism. A fixed sleep is either slower than it needs to be or occasionally shorter than the thing it is waiting for, and the second failure mode looks like flakiness rather than a bug.

- [ ] **Step 2: Add the repo-specific lint rules**

The error-logging convention holds across 29 routes by discipline alone. Encode the two conventions that already exist:

```js
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // Raw <img> is allowed here -- next/image cannot serve our own /api/images route
      // without remote patterns for a same-origin path -- but it must be an explicit
      // decision. Four files carry the disable comment and three do not, which is how a
      // warning count stops meaning anything.
      "@next/next/no-img-element": "error",
    },
  },
```

Then either add the disable comment to the three files that lack it, or fix them — matching whatever the majority of the codebase already does.

- [ ] **Step 3: Verify**

```bash
cd c2c-e-commerce && npm run lint
cd c2c-e-commerce && npx vitest run --project integration src/db/orders.integration.test.ts
```

Expected: lint reports 0 errors and 0 warnings; the orders suite passes and is faster than before.

- [ ] **Step 4: Run the full suite and commit**

```bash
cd c2c-e-commerce && npm test
```

```bash
git add c2c-e-commerce
git commit -m "chore: encode the img convention in eslint; drop the last fixed-sleep test"
```

---

## Done when

- [ ] `npm test` is green — no failures, no new skips.
- [ ] `npx tsc --noEmit` is clean.
- [ ] `npm run lint` reports 0 errors and 0 warnings.
- [ ] `npm run build` succeeds.
- [ ] `grep -rn "getClientIp" src/` returns nothing.
- [ ] `grep -rn "api.put" src/` returns nothing.
- [ ] `grep -c '"put"' src/lib/swagger-spec.json` returns 0.
- [ ] Migrations `0019` and `0020` each have a `drizzle/meta/_journal.json` entry, and `db-setup.integration.test.ts` replays cleanly from `0000`.
- [ ] Every deliberate-break step in this plan was performed and the *named* test failed.
- [ ] All 33 findings in the spec's section 14 traceability table are addressed.

## Before deploying

Neither of these is a code change, and neither can be done from an implementation session:

- [ ] Run `SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;` against the production database. Migration `0019` refuses to run if this returns rows.
- [ ] Set `TRUSTED_PROXY_HOPS=1` in Railway's variables. Unset it defaults to `0`, which is safe but silently disables IP-keyed limiting in production — the failure mode Group 1 exists to remove.
