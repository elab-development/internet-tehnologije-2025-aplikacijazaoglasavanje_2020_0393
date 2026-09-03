/**
 * C2C-SEC-8 — the link screen's post-success navigation.
 *
 * Regression spec for a finding a security review raised against the first commit of
 * this page: `returnTo` was read from the query string and passed straight to
 * `window.location.assign`, so `/link-account?returnTo=https://evil.test` would send the
 * user off-site after linking. The server sanitises the value before it ever reaches
 * this URL — but a URL is not a trusted channel, and anyone can craft this one.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LinkAccountPage from "./page";

const apiMock = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
const push = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push }),
  useSearchParams: () => searchParams.value,
}));
vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.post.mockResolvedValue({ user: { id: 1 } });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign, href: "http://localhost/link-account" },
  });
});

async function submitPassword() {
  const user = userEvent.setup();
  render(<LinkAccountPage />);
  await user.type(screen.getByLabelText(/password/i), "password123");
  await user.click(screen.getByRole("button", { name: /link account/i }));
}

describe("C2C-SEC-8 — returnTo cannot leave the site", () => {
  it("honours a same-site path", async () => {
    searchParams.value = new URLSearchParams("provider=google&returnTo=/listings/5");

    await submitPassword();

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/listings/5"));
  });

  it("ignores an absolute external origin", async () => {
    searchParams.value = new URLSearchParams(
      "provider=google&returnTo=https://evil.test/steal",
    );

    await submitPassword();

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalledWith(expect.stringContaining("evil.test"));
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("ignores a protocol-relative URL", async () => {
    searchParams.value = new URLSearchParams("provider=google&returnTo=//evil.test");

    await submitPassword();

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalledWith(expect.stringContaining("evil.test"));
  });

  it("ignores a javascript: URL", async () => {
    searchParams.value = new URLSearchParams(
      "provider=google&returnTo=javascript:alert(1)",
    );

    await submitPassword();

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalledWith(expect.stringContaining("javascript"));
  });

  it("falls back to the home page when returnTo is absent", async () => {
    searchParams.value = new URLSearchParams("provider=google");

    await submitPassword();

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("does not navigate at all when the link fails", async () => {
    searchParams.value = new URLSearchParams("provider=google&returnTo=/listings/5");
    apiMock.post.mockRejectedValue(new Error("Invalid email or password"));

    await submitPassword();

    await waitFor(() =>
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument(),
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
