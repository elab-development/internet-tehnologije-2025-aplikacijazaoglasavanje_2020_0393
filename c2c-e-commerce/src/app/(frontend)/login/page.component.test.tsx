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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./page";
import { DEFAULT_RETURN_TO } from "@/lib/oauth/return-to";

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

/**
 * The M10 error summary, distinguished from the per-field `role="alert"` paragraphs
 * `InputField` renders for each invalid field — a bare `getByRole("alert")` matches
 * both and throws "multiple elements". The summary's count line ("N fields need
 * attention") is unique to it, so locate it from there.
 */
function errorSummary(): HTMLElement {
  return screen.getByText(/fields? need attention/i).closest('[role="alert"]') as HTMLElement;
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

  it("refuses a returnTo that points off-site, unlike a same-origin one", async () => {
    const user = userEvent.setup();

    // Off-site: falls back to the default, never to the attacker's URL.
    const offSite = renderLogin({ searchParams: "returnTo=https://evil.example/steal" });
    await signIn(user);
    // safeReturnTo's default for anything off-site — see src/lib/oauth/return-to.ts.
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith(DEFAULT_RETURN_TO));
    expect(pushSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("evil.example"),
    );
    offSite.unmount();

    // Paired same-origin case: a page that ignored `returnTo` entirely (the M5 defect
    // this file exists to catch) would land here too, and be indistinguishable from the
    // off-site refusal above. The two branches must produce different destinations.
    pushSpy.mockClear();
    renderLogin({ searchParams: "returnTo=/orders/999" });
    await signIn(user);
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("/orders/999"));
    expect(pushSpy).not.toHaveBeenCalledWith(DEFAULT_RETURN_TO);
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

  it("refuses an off-site returnTo on the already-authenticated redirect too, unlike a same-origin one", async () => {
    auth.isAuthenticated = true;

    const offSite = renderLogin({ searchParams: "returnTo=https://evil.example/steal" });
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith(DEFAULT_RETURN_TO));
    offSite.unmount();

    // Paired same-origin case: a redirect that ignored `returnTo` entirely would also
    // land on DEFAULT_RETURN_TO here, indistinguishable from the off-site refusal above.
    replaceSpy.mockClear();
    renderLogin({ searchParams: "returnTo=/orders/999" });
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/orders/999"));
    expect(replaceSpy).not.toHaveBeenCalledWith(DEFAULT_RETURN_TO);
  });

  it("goes home when there is no returnTo and the visitor is already signed in", async () => {
    auth.isAuthenticated = true;
    renderLogin();

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/"));
  });
});

describe("M10 — a blank submit shows one error summary", () => {
  it("summarises both failed fields in one place and moves focus to it", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const summary = await screen.findByText(/2 fields need attention/i);
    expect(summary.closest('[role="alert"]')).toHaveFocus();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("links each summary entry to its field", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText(/fields need attention/i);

    const summary = errorSummary();
    expect(within(summary).getByRole("link", { name: "Email is required" })).toHaveAttribute(
      "href",
      "#email",
    );
    expect(within(summary).getByRole("link", { name: "Password is required" })).toHaveAttribute(
      "href",
      "#password",
    );
  });

  it("keeps the per-field errors — the summary is additive, not a replacement", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText(/fields need attention/i);

    // Both the field's own input and its InputField id="email"/"password" wiring stay
    // intact: aria-invalid and a matching aria-describedby still point at a per-field
    // message, exactly as before this task.
    const email = screen.getByLabelText(/email/i);
    expect(email).toHaveAttribute("aria-invalid", "true");
    const describedBy = email.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Email is required");
  });

  it("clears the summary once the fields are fixed and submitted successfully", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText(/fields need attention/i);

    await signIn(user);

    await waitFor(() => expect(auth.login).toHaveBeenCalled());
    expect(screen.queryByText(/fields need attention/i)).toBeNull();
  });
});
