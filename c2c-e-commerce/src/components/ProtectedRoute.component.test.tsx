/**
 * M5 spec — ProtectedRoute carries the attempted destination into the login redirect.
 *
 * Before this fix, an anonymous visit to a protected route replaced history with a bare
 * `/login`. Signing in then landed on the marketing home page instead of wherever the
 * user was actually headed, and the originally-shared link was gone from history because
 * the redirect used `replace` rather than `push`.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProtectedRoute from "./ProtectedRoute";
import type { AuthUser } from "@/context/AuthContext";

const replaceSpy = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({ pathname: "/" }));
const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  loading: false,
  user: null as AuthUser | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceSpy, push: vi.fn(), back: vi.fn() }),
  usePathname: () => nav.pathname,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    loading: auth.loading,
    isAuthenticated: auth.isAuthenticated,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

function mockPathname(pathname: string) {
  nav.pathname = pathname;
}

function mockAuth(overrides: Partial<typeof auth>) {
  Object.assign(auth, overrides);
}

beforeEach(() => {
  replaceSpy.mockClear();
  nav.pathname = "/";
  auth.isAuthenticated = false;
  auth.loading = false;
  auth.user = null;
  window.history.pushState({}, "", "/");
});

describe("M5 — carries the attempted path into the login redirect", () => {
  it("carries the attempted path into the login redirect", () => {
    mockPathname("/orders/412");
    mockAuth({ isAuthenticated: false, loading: false });

    render(
      <ProtectedRoute>
        <p>secret</p>
      </ProtectedRoute>,
    );

    expect(replaceSpy).toHaveBeenCalledWith("/login?returnTo=%2Forders%2F412");
  });

  it("URL-encodes the query string of the attempted path too", () => {
    mockPathname("/orders/412");
    window.history.pushState({}, "", "/orders/412?tab=messages&highlight=1");
    mockAuth({ isAuthenticated: false, loading: false });

    render(
      <ProtectedRoute>
        <p>secret</p>
      </ProtectedRoute>,
    );

    expect(replaceSpy).toHaveBeenCalledWith(
      `/login?returnTo=${encodeURIComponent("/orders/412?tab=messages&highlight=1")}`,
    );
  });

  it("does not redirect while the auth check is still loading", () => {
    mockPathname("/orders/412");
    mockAuth({ isAuthenticated: false, loading: true });

    render(
      <ProtectedRoute>
        <p>secret</p>
      </ProtectedRoute>,
    );

    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("renders the protected content without redirecting once authenticated", () => {
    mockPathname("/orders/412");
    mockAuth({
      isAuthenticated: true,
      loading: false,
      user: { id: 1, email: "ada@example.test", name: "Ada", role: "buyer", phoneNumber: null },
    });

    render(
      <ProtectedRoute>
        <p>secret</p>
      </ProtectedRoute>,
    );

    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
