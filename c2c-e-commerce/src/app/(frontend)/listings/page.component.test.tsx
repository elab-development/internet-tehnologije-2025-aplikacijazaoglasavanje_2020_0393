/**
 * C2C-AI-8 spec — the smart-search toggle on /listings.
 *
 * `useFetch` is mocked to record every endpoint it is asked for, which is how the mode
 * reaching the API is asserted. AC4's debounce has its own tests against the hook; here it
 * is switched off with a zero delay so the other criteria are not fighting timers.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ListingsPage from "./page";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const fetchState = vi.hoisted(() => ({
  calls: [] as (string | null)[],
  listings: null as unknown,
  loading: false,
  error: null as string | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, back: vi.fn() }),
  useSearchParams: () => nav.params,
}));

vi.mock("@/hooks/useFetch", () => ({
  useFetch: (endpoint: string | null) => {
    fetchState.calls.push(endpoint);

    if (endpoint === "/api/categories") {
      return { data: [], setData: vi.fn(), loading: false, error: null, refetch: vi.fn() };
    }
    return {
      data: fetchState.listings,
      setData: vi.fn(),
      loading: fetchState.loading,
      error: fetchState.error,
      refetch: vi.fn(),
    };
  },
}));

// The debounce is AC4's concern and has its own tests; a delay here would only make every
// other assertion wait.
vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: (value: unknown) => value,
}));

const listing = (id: number, title: string, similarity?: number) => ({
  id,
  title,
  description: "A listing",
  price: "120.00",
  coverImageId: null,
  status: "active",
  sellerId: 9,
  categoryId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...(similarity !== undefined ? { similarity } : {}),
});

const page = (rows: ReturnType<typeof listing>[]) => ({
  data: rows,
  total: rows.length,
  page: 1,
  limit: 12,
  totalPages: 1,
});

const listingCalls = () =>
  fetchState.calls.filter((url): url is string => !!url?.startsWith("/api/listings?"));

const toggle = () => screen.getByRole("checkbox", { name: /smart search/i });

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.replace.mockReset();
  fetchState.calls = [];
  fetchState.listings = page([listing(1, "Aluminium mountain bike")]);
  fetchState.loading = false;
  fetchState.error = null;
});

describe("C2C-AI-8 — AC1: the toggle drives the request", () => {
  it("AC1: keyword mode is what an untouched page asks for", () => {
    render(<ListingsPage />);

    const last = listingCalls().at(-1)!;
    expect(last).not.toContain("mode=hybrid");
  });

  it("AC1: enabling smart search switches the request to hybrid", async () => {
    const user = userEvent.setup();
    render(<ListingsPage />);

    await user.click(toggle());

    await waitFor(() => expect(listingCalls().at(-1)).toContain("mode=hybrid"));
  });

  it("AC1: results still render with smart search on", async () => {
    const user = userEvent.setup();
    render(<ListingsPage />);

    await user.click(toggle());

    expect(await screen.findByText("Aluminium mountain bike")).toBeInTheDocument();
  });

  it("AC1: turning it back off returns to keyword mode", async () => {
    const user = userEvent.setup();
    render(<ListingsPage />);

    await user.click(toggle());
    await waitFor(() => expect(listingCalls().at(-1)).toContain("mode=hybrid"));

    await user.click(toggle());
    await waitFor(() => expect(listingCalls().at(-1)).not.toContain("mode=hybrid"));
  });

  it("AC1: the placeholder invites a natural-language query when smart search is on", async () => {
    const user = userEvent.setup();
    render(<ListingsPage />);

    const before = screen.getByLabelText(/^search/i).getAttribute("placeholder");
    await user.click(toggle());
    const after = screen.getByLabelText(/^search/i).getAttribute("placeholder");

    // "Search by title" is a lie once the query is embedded rather than matched.
    expect(after).not.toBe(before);
    expect(after!.split(/\s+/).length).toBeGreaterThan(3);
  });
});

describe("C2C-AI-8 — AC2: the mode is shareable", () => {
  it("AC2: enabling smart search puts the mode in the address bar", async () => {
    const user = userEvent.setup();
    render(<ListingsPage />);

    await user.click(toggle());

    await waitFor(() =>
      expect(nav.replace.mock.calls.at(-1)![0]).toContain("mode=hybrid"),
    );
  });

  it("AC2: a URL carrying the mode starts with the toggle already on", () => {
    nav.params = new URLSearchParams("mode=hybrid&search=warm+jacket");
    render(<ListingsPage />);

    expect(toggle()).toBeChecked();
  });

  it("AC2: and asks the API for the same results", () => {
    nav.params = new URLSearchParams("mode=hybrid&search=warm+jacket");
    render(<ListingsPage />);

    expect(listingCalls().at(-1)).toContain("mode=hybrid");
  });

  it("AC2: keyword mode is not written to the URL, keeping existing links unchanged", async () => {
    render(<ListingsPage />);

    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(nav.replace.mock.calls.at(-1)![0]).not.toContain("mode=");
  });
});

describe("C2C-AI-8 — AC3: the indicator on a card", () => {
  it("AC3: a row with a similarity shows a match indicator", async () => {
    fetchState.listings = page([listing(1, "Insulated parka", 0.61)]);
    render(<ListingsPage />);

    expect(await screen.findByText(/match/i)).toBeInTheDocument();
  });

  it("AC3: a row without one shows no indicator", () => {
    fetchState.listings = page([listing(1, "Aluminium mountain bike")]);
    render(<ListingsPage />);

    expect(screen.queryByText(/match/i)).toBeNull();
  });
});

describe("C2C-AI-8 — AC5: a failed request", () => {
  it("AC5: shows an error banner", () => {
    fetchState.error = "Network error";
    render(<ListingsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(/network error/i);
  });

  it("AC5: leaves the results that were already on screen", () => {
    // The page previously cleared the grid on error. With a debounced search that fires
    // while someone is still typing, blanking the results on a transient failure is worse
    // than showing slightly stale ones under a banner.
    fetchState.listings = page([listing(1, "Aluminium mountain bike")]);
    fetchState.error = "Network error";
    render(<ListingsPage />);

    expect(screen.getByText("Aluminium mountain bike")).toBeInTheDocument();
  });
});

describe("C2C-AI-8 — AC6: the empty state", () => {
  it("AC6: smart search with no results says so in its own words", async () => {
    const user = userEvent.setup();
    fetchState.listings = page([]);
    render(<ListingsPage />);

    await user.click(toggle());

    expect(await screen.findByText(/match that description/i)).toBeInTheDocument();
  });

  it("AC6: and offers a way to switch smart search off", async () => {
    const user = userEvent.setup();
    fetchState.listings = page([]);
    render(<ListingsPage />);

    await user.click(toggle());

    const off = await screen.findByRole("button", { name: /smart search off|turn.*off/i });
    await user.click(off);

    await waitFor(() => expect(toggle()).not.toBeChecked());
  });

  it("AC6: keyword mode keeps the ordinary empty state", () => {
    fetchState.listings = page([]);
    render(<ListingsPage />);

    expect(screen.getByText(/no listings found/i)).toBeInTheDocument();
    expect(screen.queryByText(/match that description/i)).toBeNull();
  });
});

describe("C2C-AI-8 — AC7: layout", () => {
  it("AC7: the toggle sits in the filter grid rather than overflowing it", () => {
    // jsdom has no layout engine. This asserts the mechanism — the control participates in
    // the responsive grid instead of being absolutely placed beside it. A real 375 px check
    // belongs to Playwright in QA-7/QA-8.
    render(<ListingsPage />);

    const wrapper = toggle().closest("[data-testid='smart-search-control']");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toMatch(/flex/);
  });
});
