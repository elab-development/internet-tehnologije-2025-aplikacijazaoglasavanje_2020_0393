/**
 * C2C-SEC-8 AC10 — the linked-accounts section.
 *
 * The interesting case is the *disallowed* unlink. A user whose only credential is one
 * provider must be stopped, and stopped in a way that tells them how to proceed — a
 * greyed-out button with no explanation is a dead end, and the server's 409 would only
 * be seen by someone who found a way to click it anyway.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LinkedAccounts from "./LinkedAccounts";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const assign = vi.fn();

function serverSays(user: {
  linkedProviders: string[];
  hasPassword: boolean;
}) {
  apiMock.get.mockImplementation((url: string) => {
    if (url === "/api/auth/me") return Promise.resolve({ user });
    if (url === "/api/auth/providers")
      return Promise.resolve({ providers: ["google", "github"] });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.delete.mockResolvedValue({ message: "Provider unlinked" });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign, href: "http://localhost/settings" },
  });
});

describe("C2C-SEC-8 AC10 — showing what is linked", () => {
  it("marks a linked provider as connected and offers to disconnect", async () => {
    serverSays({ linkedProviders: ["google"], hasPassword: true });

    render(<LinkedAccounts />);

    const google = await screen.findByTestId("provider-google");
    expect(google).toHaveTextContent(/connected/i);
    expect(
      screen.getByRole("button", { name: /disconnect google/i }),
    ).toBeEnabled();
  });

  it("offers to connect a provider that is not linked", async () => {
    serverSays({ linkedProviders: ["google"], hasPassword: true });

    render(<LinkedAccounts />);

    expect(
      await screen.findByRole("button", { name: /connect github/i }),
    ).toBeInTheDocument();
  });

  it("lists only providers this deployment offers", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/api/auth/me")
        return Promise.resolve({ user: { linkedProviders: [], hasPassword: true } });
      return Promise.resolve({ providers: ["google"] });
    });

    render(<LinkedAccounts />);

    await screen.findByTestId("provider-google");
    expect(screen.queryByTestId("provider-github")).not.toBeInTheDocument();
  });
});

describe("C2C-SEC-8 AC10 — the last-credential guard", () => {
  it("disables the only unlink for a passwordless user and says why", async () => {
    serverSays({ linkedProviders: ["google"], hasPassword: false });

    render(<LinkedAccounts />);

    const button = await screen.findByRole("button", { name: /disconnect google/i });
    expect(button).toBeDisabled();

    // The explanation is the point. A disabled button alone is a dead end.
    expect(screen.getByTestId("provider-google")).toHaveTextContent(/password/i);
  });

  it("allows the unlink when a password also exists", async () => {
    serverSays({ linkedProviders: ["google"], hasPassword: true });

    render(<LinkedAccounts />);

    expect(
      await screen.findByRole("button", { name: /disconnect google/i }),
    ).toBeEnabled();
  });

  it("allows the unlink when a second provider exists", async () => {
    serverSays({ linkedProviders: ["google", "github"], hasPassword: false });

    render(<LinkedAccounts />);

    expect(
      await screen.findByRole("button", { name: /disconnect google/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /disconnect github/i }),
    ).toBeEnabled();
  });
});

describe("C2C-SEC-8 AC10 — acting on it", () => {
  it("disconnects and refreshes what it shows", async () => {
    const user = userEvent.setup();
    serverSays({ linkedProviders: ["google"], hasPassword: true });

    render(<LinkedAccounts />);
    await screen.findByRole("button", { name: /disconnect google/i });

    serverSays({ linkedProviders: [], hasPassword: true });
    await user.click(screen.getByRole("button", { name: /disconnect google/i }));

    expect(apiMock.delete).toHaveBeenCalledWith("/api/auth/oauth/link/google");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /connect google/i })).toBeInTheDocument(),
    );
  });

  it("surfaces the server's refusal rather than silently doing nothing", async () => {
    const user = userEvent.setup();
    serverSays({ linkedProviders: ["google"], hasPassword: true });
    apiMock.delete.mockRejectedValue(
      new Error("Set a password before unlinking your only sign-in method"),
    );

    render(<LinkedAccounts />);
    await user.click(await screen.findByRole("button", { name: /disconnect google/i }));

    await waitFor(() =>
      expect(screen.getByText(/set a password before unlinking/i)).toBeInTheDocument(),
    );
  });

  it("starts the OAuth flow when connecting", async () => {
    const user = userEvent.setup();
    serverSays({ linkedProviders: [], hasPassword: true });

    render(<LinkedAccounts />);
    await user.click(await screen.findByRole("button", { name: /connect google/i }));

    expect(assign).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/oauth/google"),
    );
  });

  it("names the provider in every button, for screen readers", async () => {
    serverSays({ linkedProviders: ["google"], hasPassword: true });

    render(<LinkedAccounts />);
    await screen.findByTestId("provider-google");

    // "Disconnect" x2 would be ambiguous announced out of context.
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAccessibleName(/google|github/i);
    }
  });
});
