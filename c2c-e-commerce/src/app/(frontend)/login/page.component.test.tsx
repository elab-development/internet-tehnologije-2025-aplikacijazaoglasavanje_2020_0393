/**
 * M5 spec — the login page's post-sign-in destination.
 *
 * The page already read `returnTo` from the query string and forwarded it to the OAuth
 * buttons, but the password path ignored it and hardcoded `router.push("/")`. Open a
 * shared link to a protected page, sign in with a password, and you landed on the
 * marketing home page instead of where you were headed.
 *
 * `safeReturnTo` (already covered by its own unit tests) is what keeps an off-site
 * `returnTo` from becoming an open redirect; this file only asserts the login page
 * actually calls it, on both the password-submit path and the already-authenticated
 * redirect.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./page";

const pushSpy = vi.hoisted(() => vi.fn());
const replaceSpy = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  loading: false,
  login: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy, replace: replaceSpy }),
  useSearchParams: () => searchParams.value,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: auth.loading,
    isAuthenticated: auth.isAuthenticated,
    login: auth.login,
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

// The login page renders <OAuthButtons>, which calls GET /api/auth/providers on mount.
// Resolving with an empty list keeps that section absent so it cannot interfere with the
// password-form assertions below.
vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

/** Renders the login page with the given raw query string (no leading `?`). */
function renderLogin({ searchParams: qs = "" }: { searchParams?: string } = {}) {
  searchParams.value = new URLSearchParams(qs);
  return render(<LoginPage />);
}

/** Fills both fields with a throwaway credential pair and submits the form. */
async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/email/i), "ada@example.test");
  await user.type(screen.getByLabelText(/password/i), "password123");
  await user.click(screen.getByRole("button", { name: /sign in/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.isAuthenticated = false;
  auth.loading = false;
  auth.login = vi.fn().mockResolvedValue(undefined);
  apiMock.get.mockResolvedValue({ providers: [] });
  apiMock.post.mockResolvedValue({ user: { id: 1 } });
});

describe("M5 — sends the user where they were going after signing in", () => {
  it("sends the user where they were going after a password sign-in", async () => {
    const user = userEvent.setup();
    renderLogin({ searchParams: "returnTo=/orders/412" });

    await signIn(user);

    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("/orders/412"));
  });

  it("falls back to the default destination when returnTo is absent", async () => {
    const user = userEvent.setup();
    renderLogin();

    await signIn(user);

    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("/"));
  });

  it("refuses a returnTo that points off-site", async () => {
    const user = userEvent.setup();
    renderLogin({ searchParams: "returnTo=https://evil.example/steal" });

    await signIn(user);

    // safeReturnTo's default for anything off-site — see src/lib/oauth/return-to.ts.
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("/"));
    expect(pushSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("evil.example"),
    );
  });

  it("does not navigate when the sign-in fails", async () => {
    auth.login = vi.fn().mockRejectedValue(new Error("Invalid email or password"));
    const user = userEvent.setup();
    renderLogin({ searchParams: "returnTo=/orders/412" });

    await signIn(user);

    await waitFor(() =>
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument(),
    );
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

describe("M5 — the already-authenticated redirect also honours returnTo", () => {
  it("sends an already signed-in visitor to their returnTo instead of home", async () => {
    auth.isAuthenticated = true;
    renderLogin({ searchParams: "returnTo=/orders/412" });

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/orders/412"));
  });

  it("refuses an off-site returnTo on the already-authenticated redirect too", async () => {
    auth.isAuthenticated = true;
    renderLogin({ searchParams: "returnTo=https://evil.example/steal" });

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/"));
  });

  it("goes home when there is no returnTo and the visitor is already signed in", async () => {
    auth.isAuthenticated = true;
    renderLogin();

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/"));
  });
});
