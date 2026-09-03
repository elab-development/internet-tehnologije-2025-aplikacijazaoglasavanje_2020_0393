/**
 * C2C-SEC-4 spec — the session lifecycle in AuthContext.
 *
 * The client half of SEC-3's 15-minute access token: restore a session the page cannot
 * read, refresh it before it lapses, and give up cleanly when it is gone.
 *
 * `api` is mocked here rather than `fetch`: the refresh *mechanics* are already pinned
 * by api.test.ts, and what this file is about is what the provider does with the
 * outcome.
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "./AuthContext";

const push = vi.hoisted(() => vi.fn());
const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  onAuthLost: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: vi.fn() }),
  usePathname: () => "/listings",
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

const USER = {
  id: 1,
  email: "ada@example.test",
  name: "Ada",
  role: "buyer" as const,
  phoneNumber: null,
};

function Probe() {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading) return <span>loading</span>;
  return (
    <span data-testid="state">
      {isAuthenticated ? `in:${user?.name}` : "out"}
    </span>
  );
}

const renderProvider = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ user: USER });
  apiMock.post.mockResolvedValue({ user: USER });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("C2C-SEC-4 AC2 — the session survives a reload", () => {
  it("restores the user from the httpOnly cookie on mount", async () => {
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("in:Ada"),
    );
    expect(apiMock.get).toHaveBeenCalledWith("/api/auth/me");
  });

  it("shows a loading state first, not a flash of logged-out UI", async () => {
    renderProvider();

    // Before the bootstrap resolves the provider must not claim the user is signed out.
    expect(screen.getByText("loading")).toBeInTheDocument();

    // Let the mocked bootstrap fetch settle before the test ends — otherwise its state
    // update lands after this test has already returned, outside any act() scope.
    await waitFor(() => expect(screen.getByTestId("state")).toBeInTheDocument());
  });
});

describe("C2C-SEC-4 AC7 — a visitor who was never signed in", () => {
  it("settles as logged out without redirecting or throwing", async () => {
    apiMock.get.mockRejectedValue(new Error("Not authenticated"));

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("out"),
    );
    // No error screen, no bounce to /login: not being logged in is not a failure.
    expect(push).not.toHaveBeenCalled();
  });
});

describe("C2C-SEC-4 AC5 — an unrecoverable session", () => {
  it("registers a handler with the API client", async () => {
    renderProvider();

    await waitFor(() => expect(apiMock.onAuthLost).toHaveBeenCalled());
    expect(typeof apiMock.onAuthLost.mock.calls[0][0]).toBe("function");
  });

  it("clears the user and redirects to /login when that handler fires", async () => {
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("in:Ada"),
    );

    const onAuthLost = apiMock.onAuthLost.mock.calls[0][0] as () => void;
    act(() => onAuthLost());

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("out"),
    );
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("unregisters the handler on unmount, so a dead provider cannot redirect", async () => {
    const { unmount } = renderProvider();
    await waitFor(() => expect(apiMock.onAuthLost).toHaveBeenCalled());

    unmount();

    expect(apiMock.onAuthLost).toHaveBeenLastCalledWith(null);
  });
});

describe("C2C-SEC-4 AC9 — proactive refresh", () => {
  it("refreshes before the 15-minute token lapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("in:Ada"),
    );

    expect(apiMock.post).not.toHaveBeenCalledWith("/api/auth/refresh");

    // 13 minutes: inside the token's lifetime, with margin for a slow request.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(13 * 60 * 1000);
    });

    expect(apiMock.post).toHaveBeenCalledWith("/api/auth/refresh");
  });

  it("does not schedule a refresh for a logged-out visitor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiMock.get.mockRejectedValue(new Error("Not authenticated"));

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("out"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    });

    expect(apiMock.post).not.toHaveBeenCalledWith("/api/auth/refresh");
  });
});

describe("C2C-SEC-4 AC8 — logout", () => {
  /** Drives logout through the context the way a real component would. */
  function LogoutHarness() {
    const { logout } = useAuth();
    return (
      <>
        <button onClick={logout}>sign out</button>
        <Probe />
      </>
    );
  }

  const renderHarness = () =>
    render(
      <AuthProvider>
        <LogoutHarness />
      </AuthProvider>,
    );

  it("revokes the server-side session and clears local state", async () => {
    const user = userEvent.setup();
    renderHarness();
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("in:Ada"),
    );

    await user.click(screen.getByText("sign out"));

    // The route revokes the whole token family (SEC-3 AC8); without this call the
    // refresh cookie would still mint sessions after "logging out".
    expect(apiMock.post).toHaveBeenCalledWith("/api/auth/logout");
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("out"),
    );
  });

  it("clears local state even when the server call fails", async () => {
    const user = userEvent.setup();
    renderHarness();
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("in:Ada"),
    );

    apiMock.post.mockRejectedValueOnce(new Error("network down"));
    await user.click(screen.getByText("sign out"));

    // Leaving the UI signed in after a failed logout is worse than the failure.
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("out"),
    );
  });

  it("stops the proactive refresh timer after logout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHarness();
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("in:Ada"),
    );

    screen.getByText("sign out").click();
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("out"),
    );
    apiMock.post.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    });

    expect(apiMock.post).not.toHaveBeenCalledWith("/api/auth/refresh");
  });
});
