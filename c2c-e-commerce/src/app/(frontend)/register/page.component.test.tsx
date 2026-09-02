/**
 * M11 spec — the register page's buyer/seller selector is not colour-only.
 *
 * Follows the mocking idiom in `login/page.component.test.tsx`: `useAuth` is mocked
 * directly rather than rendering `AuthProvider`, and `@/lib/api` is mocked so
 * `OAuthButtons`'s `GET /api/auth/providers` call resolves to an empty list and stays
 * out of the way of the role-selector assertions.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RegisterPage from "./page";

const pushSpy = vi.hoisted(() => vi.fn());
const replaceSpy = vi.hoisted(() => vi.fn());
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  loading: false,
  register: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy, replace: replaceSpy }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: auth.loading,
    isAuthenticated: auth.isAuthenticated,
    login: vi.fn(),
    register: auth.register,
    logout: vi.fn(),
  }),
}));

// OAuthButtons calls GET /api/auth/providers on mount; an empty list keeps that section
// absent so it cannot interfere with the role-selector assertions below.
vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

function renderRegister() {
  return render(<RegisterPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.isAuthenticated = false;
  auth.loading = false;
  auth.register = vi.fn().mockResolvedValue(undefined);
  apiMock.get.mockResolvedValue({ providers: [] });
});

describe("M11 — the role selector is not colour-only", () => {
  it("is a named, required radio group", async () => {
    renderRegister();
    const group = await screen.findByRole("radiogroup", { name: /i want to/i });
    expect(group).toHaveAttribute("aria-required", "true");
  });

  it("names the options without reading the emoji", async () => {
    renderRegister();
    expect(await screen.findByRole("radio", { name: "Buy" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Sell" })).toBeInTheDocument();
  });

  it("reports the selection", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.click(await screen.findByRole("radio", { name: "Sell" }));

    // Direct attribute assertions rather than toBeChecked(): the matcher throws a
    // usage error when aria-checked is absent entirely, which would mask the defect
    // this test exists to catch rather than reporting it as a wrong value. The second
    // line matters — aria-checked="false" is meaningfully different from the attribute
    // being absent, and only a direct assertion distinguishes them.
    expect(screen.getByRole("radio", { name: "Sell" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Buy" })).toHaveAttribute("aria-checked", "false");
  });

  it("defaults to buyer, matching the pre-selected visual state", async () => {
    renderRegister();
    expect(await screen.findByRole("radio", { name: "Buy" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Sell" })).not.toBeChecked();
  });

  it("moves focus along with the selection on arrow-key navigation", async () => {
    const user = userEvent.setup();
    renderRegister();

    screen.getByRole("radio", { name: "Buy" }).focus();
    await user.keyboard("{ArrowRight}");

    const sell = screen.getByRole("radio", { name: "Sell" });
    expect(sell).toBeChecked();
    expect(sell).toHaveFocus();
    expect(sell).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Buy" })).toHaveAttribute("tabindex", "-1");
  });
});
