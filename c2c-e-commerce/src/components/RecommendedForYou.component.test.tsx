/**
 * C2C-AI-10 spec — AC8, the "Recommended for you" section.
 *
 * `strategy` is deliberately visible to this component: the story calls it what makes the
 * cold-start "honest in the UI", so a popular list must not be presented as personal.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RecommendedForYou from "./RecommendedForYou";

const auth = vi.hoisted(() => ({ isAuthenticated: false }));
const fetchState = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  error: null as string | null,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: auth.isAuthenticated ? { id: 1, name: "Ada", role: "buyer" } : null,
    loading: false,
    isAuthenticated: auth.isAuthenticated,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFetch", () => ({
  useFetch: () => ({
    data: fetchState.data,
    setData: vi.fn(),
    loading: fetchState.loading,
    error: fetchState.error,
    refetch: vi.fn(),
  }),
}));

const row = (id: number, title: string) => ({
  id,
  title,
  price: "120.00",
  coverImageId: null,
  status: "active",
  sellerId: 9,
  categoryId: 1,
});

beforeEach(() => {
  auth.isAuthenticated = false;
  fetchState.data = null;
  fetchState.loading = false;
  fetchState.error = null;
});

describe("C2C-AI-10 — AC8: who sees the section", () => {
  it("AC8: an anonymous visitor sees nothing at all", () => {
    auth.isAuthenticated = false;
    fetchState.data = { data: [row(2, "Gravel bike")], strategy: "popular" };

    const { container } = render(<RecommendedForYou />);

    // Not an empty heading, not a sign-in prompt — the section is simply absent.
    expect(container).toBeEmptyDOMElement();
  });

  it("AC8: a logged-in user sees the section", () => {
    auth.isAuthenticated = true;
    fetchState.data = { data: [row(2, "Gravel bike")], strategy: "personalised" };

    render(<RecommendedForYou />);
    expect(screen.getByRole("heading", { name: /recommended/i })).toBeInTheDocument();
  });

  it("AC8: each recommendation links to its listing", () => {
    auth.isAuthenticated = true;
    fetchState.data = { data: [row(7, "Gravel bike")], strategy: "personalised" };

    render(<RecommendedForYou />);
    expect(screen.getByRole("link", { name: /gravel bike/i })).toHaveAttribute(
      "href",
      "/listings/7",
    );
  });

  it("renders the price with a currency symbol, like every other surface", () => {
    // Regression: this strip rendered "120.00" while /listings rendered "$120.00"
    // for the same listing. getByText(/120/) matched both, which is why it survived.
    auth.isAuthenticated = true;
    fetchState.data = { data: [row(2, "Gravel bike")], strategy: "personalised" };

    render(<RecommendedForYou />);
    expect(screen.getByText("$120.00")).toBeInTheDocument();
  });
});

describe("C2C-AI-10 — AC8: the strategy is shown honestly", () => {
  it("presents a personalised list as personal", () => {
    auth.isAuthenticated = true;
    fetchState.data = { data: [row(2, "Gravel bike")], strategy: "personalised" };

    render(<RecommendedForYou />);
    expect(screen.getByRole("heading", { name: /recommended for you/i })).toBeInTheDocument();
  });

  it("does not claim a popular list is based on the user's history", () => {
    // The story's reason for the field: a cold-start list dressed up as personal is a
    // small lie the UI tells on every first visit.
    auth.isAuthenticated = true;
    fetchState.data = { data: [row(2, "Gravel bike")], strategy: "popular" };

    render(<RecommendedForYou />);
    const heading = screen.getByRole("heading");
    expect(heading.textContent?.toLowerCase()).not.toContain("for you");
  });
});

describe("C2C-AI-10 — the section hides itself when it has nothing", () => {
  it("renders nothing for an empty list", () => {
    auth.isAuthenticated = true;
    fetchState.data = { data: [], strategy: "popular" };

    const { container } = render(<RecommendedForYou />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while loading", () => {
    auth.isAuthenticated = true;
    fetchState.loading = true;

    const { container } = render(<RecommendedForYou />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the request fails", () => {
    auth.isAuthenticated = true;
    fetchState.error = "Network error";

    const { container } = render(<RecommendedForYou />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the body is malformed", () => {
    auth.isAuthenticated = true;
    fetchState.data = { error: "Unauthorized" };

    const { container } = render(<RecommendedForYou />);
    expect(container).toBeEmptyDOMElement();
  });
});
