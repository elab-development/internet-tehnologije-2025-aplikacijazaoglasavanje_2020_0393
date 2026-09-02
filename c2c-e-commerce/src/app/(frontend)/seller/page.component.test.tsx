/**
 * H10 spec — the seller dashboard's view switch is not an ARIA tab widget.
 *
 * `useAuth` is mocked directly (rather than rendering `AuthProvider`) so `ProtectedRoute`
 * sees an already-authenticated seller and renders its children synchronously, the same
 * idiom `AuthContext.component.test.tsx` uses for the provider itself. `useFetch` and
 * `useCurrencyConversion` are mocked so the dashboard and its two tabs render with no
 * network activity — the orders fetch (`/api/orders/seller?limit=100`) and the listings
 * tab's own fetch both go through the same mocked hook.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SellerDashboardPage from "./page";
import type { AuthUser } from "@/context/AuthContext";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  usePathname: () => "/seller",
}));

const SELLER = {
  id: 7,
  email: "seller@example.test",
  name: "Sami Seller",
  role: "seller" as const,
  phoneNumber: null,
};

const BUYER = {
  id: 8,
  email: "buyer@example.test",
  name: "Bea Buyer",
  role: "buyer" as const,
  phoneNumber: null,
};

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isAuthenticated: true,
  loading: false,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    isAuthenticated: auth.isAuthenticated,
    loading: auth.loading,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFetch", () => ({
  useFetch: () => ({
    data: null,
    setData: vi.fn(),
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCurrencyConversion", () => ({
  useCurrencyConversion: () => ({
    selectedCurrency: "USD",
    setSelectedCurrency: vi.fn(),
    loadingRates: false,
    ratesError: null,
    availableCurrencies: ["USD", "EUR", "GBP", "RSD"],
    convertFromUsd: (amount: number) => amount,
    formatConverted: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

function renderSellerDashboard() {
  return render(<SellerDashboardPage />);
}

beforeEach(() => {
  auth.user = SELLER;
  auth.isAuthenticated = true;
  auth.loading = false;
  nav.push.mockClear();
  nav.replace.mockClear();
});

describe("H10 — the dashboard does not claim to be a tab widget", () => {
  it("offers plain buttons, not tabs", async () => {
    renderSellerDashboard();
    // queryByRole throws on multiple matches, so it would crash rather than fail if the
    // roles came back — and would behave differently for one leftover role than for two.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByRole("tablist")).toHaveLength(0);
    expect(
      await screen.findByRole("button", { name: /incoming orders/i }),
    ).toBeInTheDocument();
  });

  it("marks the active view with aria-current", async () => {
    const user = userEvent.setup();
    renderSellerDashboard();

    const orders = await screen.findByRole("button", { name: /incoming orders/i });
    const listings = screen.getByRole("button", { name: /my listings/i });

    expect(orders).toHaveAttribute("aria-current", "true");
    expect(listings).not.toHaveAttribute("aria-current");

    await user.click(listings);
    expect(listings).toHaveAttribute("aria-current", "true");
    expect(orders).not.toHaveAttribute("aria-current");
  });
});

describe("L17 — /seller is seller-only", () => {
  it("does not show a buyer the dashboard", () => {
    auth.user = BUYER;
    renderSellerDashboard();
    expect(screen.queryByRole("heading", { name: /seller dashboard/i })).toBeNull();
    expect(nav.replace).toHaveBeenCalledWith("/");
  });

  it("still shows a seller the dashboard", async () => {
    renderSellerDashboard();
    expect(
      await screen.findByRole("heading", { name: /seller dashboard/i }),
    ).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
