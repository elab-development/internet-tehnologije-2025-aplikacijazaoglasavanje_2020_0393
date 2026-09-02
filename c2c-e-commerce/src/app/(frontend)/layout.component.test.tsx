/**
 * M13 — a skip link bypasses the navbar.
 *
 * `@/context/AuthContext` is mocked wholesale: `AuthProvider` becomes a pass-through
 * and `useAuth` returns a signed-out visitor, matching the seller-dashboard test's
 * idiom (`src/app/(frontend)/seller/page.component.test.tsx`), so the layout renders
 * synchronously with no network activity.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import FrontendLayout from "./layout";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

function renderLayout() {
  return render(
    <FrontendLayout>
      <p>Page content</p>
    </FrontendLayout>,
  );
}

describe("M13 — a skip link bypasses the navbar", () => {
  it("is the first thing in the tab order", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.tab();

    expect(
      screen.getByRole("link", { name: /skip to main content/i }),
    ).toHaveFocus();
  });

  it("points at the main landmark", () => {
    renderLayout();

    expect(
      screen.getByRole("link", { name: /skip to main content/i }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });
});
