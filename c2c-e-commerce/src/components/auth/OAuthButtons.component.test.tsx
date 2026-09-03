/**
 * C2C-SEC-9 spec — the provider buttons.
 *
 * These are the visible half of the OAuth work, so the assertions are about what a
 * person actually encounters: which buttons exist, whether a keyboard reaches them,
 * what a screen reader announces, and whether an error says something useful.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OAuthButtons from "./OAuthButtons";

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

/** Captures the navigation a click triggers, since jsdom will not perform one. */
const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ providers: ["google", "github"] });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign, href: "http://localhost/login", search: "" },
  });
});

const button = (name: RegExp) => screen.getByRole("button", { name });

describe("C2C-SEC-9 AC1 — both providers configured", () => {
  it("renders a button for each", async () => {
    render(<OAuthButtons />);

    expect(await screen.findByRole("button", { name: /google/i })).toBeInTheDocument();
    expect(button(/github/i)).toBeInTheDocument();
  });

  it("separates them from the password form with a labelled divider", async () => {
    render(<OAuthButtons />);
    await screen.findByRole("button", { name: /google/i });

    // A bare rule is decoration; the text is what tells the user these are alternatives.
    expect(screen.getByText(/or/i)).toBeInTheDocument();
  });
});

describe("C2C-SEC-9 AC2 — only one provider configured", () => {
  it("renders only the configured one", async () => {
    apiMock.get.mockResolvedValue({ providers: ["google"] });

    render(<OAuthButtons />);

    expect(await screen.findByRole("button", { name: /google/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /github/i })).not.toBeInTheDocument();
  });

  it("renders nothing at all when none are configured", async () => {
    apiMock.get.mockResolvedValue({ providers: [] });

    const { container } = render(<OAuthButtons />);

    // No stray divider or empty box hanging under the form.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing when the lookup fails", async () => {
    apiMock.get.mockRejectedValue(new Error("offline"));

    const { container } = render(<OAuthButtons />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("C2C-SEC-9 AC3 — clicking a provider", () => {
  it("navigates to that provider's initiate route", async () => {
    const user = userEvent.setup();
    render(<OAuthButtons />);
    await screen.findByRole("button", { name: /google/i });

    await user.click(button(/google/i));

    expect(assign).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/oauth/google"),
    );
  });

  it("shows a loading state and stops accepting further clicks", async () => {
    const user = userEvent.setup();
    render(<OAuthButtons />);
    await screen.findByRole("button", { name: /google/i });

    await user.click(button(/google/i));

    // A full-page redirect is in flight; a second click would start a second
    // transaction and discard the first one's cookie.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /google/i })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: /github/i })).toBeDisabled();
  });
});

describe("C2C-SEC-9 AC6 — returnTo", () => {
  it("passes the current path so the user comes back to it", async () => {
    const user = userEvent.setup();
    render(<OAuthButtons returnTo="/listings/5" />);
    await screen.findByRole("button", { name: /github/i });

    await user.click(button(/github/i));

    expect(assign).toHaveBeenCalledWith(
      expect.stringContaining("returnTo=%2Flistings%2F5"),
    );
  });

  it("omits returnTo when there is nowhere particular to go back to", async () => {
    const user = userEvent.setup();
    render(<OAuthButtons />);
    await screen.findByRole("button", { name: /google/i });

    await user.click(button(/google/i));

    expect(assign).toHaveBeenCalledWith(expect.not.stringContaining("returnTo"));
  });
});

describe("C2C-SEC-9 AC7/AC9 — keyboard and screen reader", () => {
  it("reaches both buttons by Tab", async () => {
    const user = userEvent.setup();
    render(<OAuthButtons />);
    await screen.findByRole("button", { name: /google/i });

    await user.tab();
    expect(button(/google/i)).toHaveFocus();

    await user.tab();
    expect(button(/github/i)).toHaveFocus();
  });

  it("activates with Enter", async () => {
    const user = userEvent.setup();
    render(<OAuthButtons />);
    await screen.findByRole("button", { name: /google/i });

    await user.tab();
    await user.keyboard("{Enter}");

    expect(assign).toHaveBeenCalled();
  });

  it("names the provider in the accessible name", async () => {
    render(<OAuthButtons />);

    // An icon-only button would pass a visual review and announce nothing useful.
    expect(await screen.findByRole("button", { name: /continue with google/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with github/i }))
      .toBeInTheDocument();
  });

  it("hides the decorative provider icons from assistive technology", async () => {
    render(<OAuthButtons />);
    const google = await screen.findByRole("button", { name: /google/i });

    // A conditional assertion here would pass vacuously if the icon were removed
    // entirely — assert its presence first so the check cannot silently no-op.
    const icon = google.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("uses real buttons, not clickable divs", async () => {
    render(<OAuthButtons />);
    const google = await screen.findByRole("button", { name: /google/i });

    expect(google.tagName).toBe("BUTTON");
    expect(google).toHaveAttribute("type", "button");
  });
});

describe("C2C-SEC-9 AC8 — narrow viewports", () => {
  it("stacks the buttons in a single column", async () => {
    render(<OAuthButtons />);
    const google = await screen.findByRole("button", { name: /google/i });

    // jsdom does not lay out, so this checks the stacking contract rather than pixels:
    // a column flex container and full-width buttons cannot overflow at 375px.
    const group = google.closest("[data-testid='oauth-buttons']");
    expect(group).toHaveClass("flex-col");
    expect(google).toHaveClass("w-full");
  });
});
