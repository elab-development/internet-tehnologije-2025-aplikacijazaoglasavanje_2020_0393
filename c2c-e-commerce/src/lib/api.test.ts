/**
 * C2C-SEC-4 spec — silent refresh in the API client.
 *
 * With a 15-minute access token (SEC-3), a lapsed token is now an ordinary event rather
 * than an edge case: any request can come back 401 simply because the user read a page
 * for a quarter of an hour. The client has to recover from that without the caller — or
 * the user — ever seeing it.
 *
 * `fetch` is stubbed rather than the module under test, so these assert real behaviour
 * of `api.*`: what it sends, how many times, and in what order.
 *
 * Rescoped by D5a: the original story also moved a token out of `localStorage` into
 * React state. There is no client-held token any more, so AC1 and AC10 survive only as
 * regression guards and the rest is about refresh behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, __resetRefreshState } from "./api";

type Call = { url: string; init: RequestInit };

let calls: Call[];

/** A queue of canned responses, consumed in order; the last one repeats. */
function respondWith(
  ...statuses: Array<
    number | { status: number; body?: unknown; headers?: Record<string, string> }
  >
) {
  const queue = statuses.map((s) => (typeof s === "number" ? { status: s } : s));

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const spec = queue.length > 1 ? queue.shift()! : queue[0];

      return new Response(JSON.stringify(spec.body ?? { ok: true }), {
        status: spec.status,
        headers: { "content-type": "application/json", ...(spec.headers ?? {}) },
      });
    }),
  );
}

const refreshCalls = () => calls.filter((c) => c.url.includes("/api/auth/refresh"));

beforeEach(() => {
  calls = [];
  __resetRefreshState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("C2C-SEC-4 AC3 — a lapsed access token is refreshed silently", () => {
  it("refreshes and retries once, and the caller sees the successful result", async () => {
    // original 401 -> refresh 200 -> retry 200
    respondWith(401, { status: 200 }, { status: 200, body: { id: 7 } });

    const result = await api.get<{ id: number }>("/api/listings/7");

    expect(result).toEqual({ id: 7 });
    expect(refreshCalls()).toHaveLength(1);
    // The caller never observes the 401.
    expect(calls.map((c) => c.url)).toEqual([
      "/api/listings/7",
      "/api/auth/refresh",
      "/api/listings/7",
    ]);
  });

  it("replays the original method and body on the retry", async () => {
    respondWith(401, { status: 200 }, { status: 200 });

    await api.post("/api/listings", { title: "Bike" });

    const retry = calls[2];
    expect(retry.init.method).toBe("POST");
    expect(retry.init.body).toBe(JSON.stringify({ title: "Bike" }));
  });

  it("does not refresh when the request succeeds", async () => {
    respondWith(200);

    await api.get("/api/listings");

    expect(refreshCalls()).toHaveLength(0);
  });

  it("does not refresh on a non-401 error", async () => {
    // A 403 is an authorisation decision, not a lapsed token. Refreshing would turn
    // every permission error into two requests and still fail.
    respondWith(403);

    await expect(api.get("/api/admin")).rejects.toThrow();
    expect(refreshCalls()).toHaveLength(0);
  });

  it("never tries to refresh the refresh call itself", async () => {
    respondWith(401);

    await expect(api.post("/api/auth/refresh")).rejects.toThrow();

    // One attempt, no recursion.
    expect(calls).toHaveLength(1);
  });

  it("does not refresh when login itself is rejected", async () => {
    // A wrong password is a 401 the user must see, not a session to recover.
    respondWith(401);

    await expect(api.post("/api/auth/login", {})).rejects.toThrow();
    expect(refreshCalls()).toHaveLength(0);
  });
});

describe("C2C-SEC-4 AC4 — single-flight refresh", () => {
  it("sends exactly one refresh for three concurrent 401s", async () => {
    let refreshes = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const target = String(url);
        calls.push({ url: target, init: {} });

        if (target.includes("/api/auth/refresh")) {
          refreshes += 1;
          // Force overlap: all three callers must be waiting on this one promise.
          await new Promise((resolve) => setTimeout(resolve, 20));
          return new Response("{}", { status: 200 });
        }

        // 401 until the refresh completes, then 200.
        return new Response(JSON.stringify({ ok: refreshes > 0 }), {
          status: refreshes > 0 ? 200 : 401,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const results = await Promise.all([
      api.get("/api/a"),
      api.get("/api/b"),
      api.get("/api/c"),
    ]);

    expect(refreshes).toBe(1);
    expect(results).toHaveLength(3);
  });

  it("lets a later request refresh again once the first flight is over", async () => {
    respondWith(401, { status: 200 }, { status: 200 });
    await api.get("/api/one");

    calls = [];
    respondWith(401, { status: 200 }, { status: 200 });
    await api.get("/api/two");

    // The in-flight promise must be cleared, not cached forever.
    expect(refreshCalls()).toHaveLength(1);
  });
});

describe("C2C-SEC-4 AC5/AC6 — giving up", () => {
  it("AC6: surfaces the error when the retry also 401s, without refreshing twice", async () => {
    respondWith(401, { status: 200 }, { status: 401 });

    await expect(api.get("/api/listings")).rejects.toThrow();

    expect(refreshCalls()).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("AC5: surfaces the error and does not retry when the refresh itself fails", async () => {
    respondWith(401, { status: 401 });

    await expect(api.get("/api/listings")).rejects.toThrow();

    // original + refresh, and no retry of the original.
    expect(calls).toHaveLength(2);
  });

  it("AC5: notifies the app once when a refresh fails, so it can clear auth state", async () => {
    const onAuthLost = vi.fn();
    api.onAuthLost(onAuthLost);

    respondWith(401, { status: 401 });
    await expect(api.get("/api/listings")).rejects.toThrow();

    expect(onAuthLost).toHaveBeenCalledTimes(1);

    api.onAuthLost(null);
  });

  it("does not announce a lost session when the refresh succeeds", async () => {
    const onAuthLost = vi.fn();
    api.onAuthLost(onAuthLost);

    respondWith(401, { status: 200 }, { status: 200 });
    await api.get("/api/listings");

    expect(onAuthLost).not.toHaveBeenCalled();

    api.onAuthLost(null);
  });
});

describe("C2C-SEC-4 AC7 — a logged-out visitor", () => {
  it("makes exactly one refresh attempt and fails quietly", async () => {
    respondWith(401, { status: 401 });

    // The caller still gets a rejection to handle; what matters is that the client
    // does not sit in a refresh loop for someone who was never signed in.
    await expect(api.get("/api/auth/me")).rejects.toThrow();

    expect(refreshCalls()).toHaveLength(1);
  });
});

describe("C2C-SEC-4 AC1/AC10 — no token in browser storage", () => {
  it("sends credentials with every request rather than an Authorization header", async () => {
    respondWith(200);

    await api.get("/api/listings");

    expect(calls[0].init.credentials).toBe("include");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("touches no browser storage", async () => {
    const getItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    respondWith(401, { status: 200 }, { status: 200 });
    await api.get("/api/listings");

    expect(getItem).not.toHaveBeenCalled();
  });
});

describe("ApiError — the client preserves what the server said", () => {
  it("carries the HTTP status so callers can tell 409 from 500", async () => {
    respondWith({ status: 409, body: { error: "This listing already has an order in progress" } });

    const err = await api.post("/api/orders", { listingId: 7 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("This listing already has an order in progress");
  });

  it("parses Retry-After and X-RateLimit-Remaining on a 429", async () => {
    respondWith({
      status: 429,
      body: { error: "Too many requests" },
      headers: { "Retry-After": "45", "X-RateLimit-Remaining": "0" },
    });

    const err = (await api.get("/api/listings").catch((e: unknown) => e)) as ApiError;

    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(45);
    expect(err.rateLimitRemaining).toBe(0);
  });

  it("yields null rather than a wrong number for a non-integer Retry-After", async () => {
    // The HTTP-date form is legal but our API does not send it. Guessing would be worse
    // than admitting we do not know.
    respondWith({
      status: 429,
      body: { error: "slow down" },
      headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
    });

    const err = (await api.get("/api/listings").catch((e: unknown) => e)) as ApiError;

    expect(err.retryAfterSeconds).toBeNull();
  });

  it("is still an Error, so every existing `instanceof Error` site keeps working", async () => {
    respondWith({ status: 500, body: { error: "boom" } });

    const err = await api.get("/api/listings").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err instanceof Error ? err.message : null).toBe("boom");
  });
});
