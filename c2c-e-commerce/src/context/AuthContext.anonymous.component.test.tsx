/**
 * C2C-SEC-4 AC7 regression — the provider and the API client, composed.
 *
 * The sibling spec (AuthContext.component.test.tsx) mocks `@/lib/api`, and api.test.ts
 * stubs `fetch` but never registers an `onAuthLost` handler. Between them the seam is
 * untested by construction: neither can see what happens when the provider's bootstrap
 * `GET /api/auth/me` 401s and reaches the real handler. That is every anonymous page
 * load, so this file wires the two together over a stubbed `fetch` and asserts the
 * outcome.
 *
 * `/api/auth/me` is in `NO_REFRESH` (M2, src/lib/api.ts): its 401 on every anonymous
 * first paint is not a lapsed session, so the bootstrap must settle as logged out
 * without ever calling `/api/auth/refresh`.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, __resetRefreshState } from "@/lib/api";

import { AuthProvider, useAuth } from "./AuthContext";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: vi.fn() }),
  usePathname: () => "/listings",
}));

const USER = {
  id: 1,
  email: "ada@example.test",
  name: "Ada",
  role: "buyer" as const,
  phoneNumber: null,
};

let calls: string[];

/** Stubs `fetch` with a status per endpoint. Anything unlisted answers 200 `{}`. */
function respondWith(routes: Record<string, { status: number; body?: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(String(url), "http://localhost").pathname;
      calls.push(path);

      const spec = routes[path] ?? { status: 200 };
      return new Response(JSON.stringify(spec.body ?? { error: "Not authenticated" }), {
        status: spec.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

const refreshCalls = () => calls.filter((c) => c === "/api/auth/refresh");

function Probe() {
  const { user, loading, isAuthenticated } = useAuth();

  return (
    <>
      {loading ? (
        <span>loading</span>
      ) : (
        <span data-testid="state">{isAuthenticated ? `in:${user?.name}` : "out"}</span>
      )}
      <button onClick={() => void api.get("/api/listings").catch(() => {})}>
        load listings
      </button>
    </>
  );
}

const renderProvider = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

beforeEach(() => {
  calls = [];
  push.mockClear();
  __resetRefreshState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("C2C-SEC-4 AC7 — a visitor who was never signed in", () => {
  it("stays on the page instead of being bounced to /login", async () => {
    respondWith({
      "/api/auth/me": { status: 401 },
      "/api/auth/refresh": { status: 401 },
    });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));

    // The provider wraps every page in the (frontend) layout, so redirecting here would
    // bounce anonymous visitors off /, /listings and /register — all of which are
    // deliberately public.
    expect(push).not.toHaveBeenCalled();
  });

  it("M2: does not attempt a refresh at all for the whole bootstrap", async () => {
    // /api/auth/me is in NO_REFRESH (src/lib/api.ts): its 401 on every anonymous first
    // paint is not a lapsed session, so treating it as one must not spend any of the
    // refresh route's per-IP budget. This used to assert "exactly one" attempt — that
    // was the cost this fix removes.
    respondWith({
      "/api/auth/me": { status: 401 },
      "/api/auth/refresh": { status: 401 },
    });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));

    expect(refreshCalls()).toHaveLength(0);
  });
});

describe("C2C-SEC-4 AC5 — a session that is genuinely lost", () => {
  it("still clears the user and redirects once a session has existed", async () => {
    // Positive control for the test above: the fix must be "no session to lose", not
    // "never redirect".
    respondWith({
      "/api/auth/me": { status: 200, body: { user: USER } },
      "/api/listings": { status: 401 },
      "/api/auth/refresh": { status: 401 },
    });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:Ada"));

    await userEvent.click(screen.getByRole("button", { name: /load listings/i }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    expect(push).toHaveBeenCalledWith("/login");
  });
});
