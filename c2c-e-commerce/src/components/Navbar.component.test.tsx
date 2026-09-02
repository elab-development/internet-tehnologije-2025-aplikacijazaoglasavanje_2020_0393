/**
 * L5/M9 — the Navbar's link list, extracted into one NAV_LINKS array + a
 * variant-parameterised NavLinks component instead of being hand-written twice
 * (desktop, mobile) with the seller-only links conditioned four separate times.
 *
 * `useAuth` is mocked directly, the same idiom `seller/page.component.test.tsx`
 * uses, so the nav renders synchronously for a chosen role with no network
 * activity. Only the desktop link list is in the DOM by default (the mobile
 * drawer only renders once the hamburger is opened), so a bare `getByRole`
 * unambiguously finds the one link that matters.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Navbar from "./Navbar";
import type { AuthUser } from "@/context/AuthContext";

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  loading: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    loading: auth.loading,
    isAuthenticated: auth.user !== null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

/** Renders the Navbar signed in as the given role, or signed out when omitted. */
function renderNavbar({ user }: { user?: Partial<AuthUser> } = {}) {
  auth.user = user
    ? {
        id: 1,
        email: "person@example.test",
        name: "Test Person",
        phoneNumber: null,
        role: "buyer",
        ...user,
      }
    : null;
  return render(<Navbar />);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = null;
  auth.loading = false;
});

describe("M9 — Settings is reachable from the nav", () => {
  it("links to settings, which was previously unreachable", () => {
    renderNavbar({ user: { role: "buyer" } });
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("is reachable to a signed-out visitor too — the page, not the nav, gates it", () => {
    renderNavbar();
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});

describe("L5 — offers the seller links only to sellers", () => {
  it("offers the seller links only to sellers", () => {
    renderNavbar({ user: { role: "buyer" } });
    expect(screen.queryByRole("link", { name: /seller dashboard/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /sell item/i })).toBeNull();
  });

  it("hides the seller links from a signed-out visitor", () => {
    renderNavbar();
    expect(screen.queryByRole("link", { name: /seller dashboard/i })).toBeNull();
  });

  it("shows the seller links to a seller", () => {
    renderNavbar({ user: { role: "seller" } });
    expect(screen.getByRole("link", { name: /seller dashboard/i })).toHaveAttribute(
      "href",
      "/seller",
    );
    expect(screen.getByRole("link", { name: /sell item/i })).toHaveAttribute(
      "href",
      "/listings/new",
    );
  });

  it("shows the seller links to an admin too", () => {
    renderNavbar({ user: { role: "admin" } });
    expect(screen.getByRole("link", { name: /seller dashboard/i })).toBeInTheDocument();
  });
});
