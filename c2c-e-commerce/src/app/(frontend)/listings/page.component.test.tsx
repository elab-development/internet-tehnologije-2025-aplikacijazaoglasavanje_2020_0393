/**
 * C2C-AI-8 spec — the smart-search toggle on /listings.
 *
 * `useFetch` is mocked to record every endpoint it is asked for, which is how the mode
 * reaching the API is asserted. AC4's debounce has its own tests against the hook and runs
 * for real here (see the note by its `vi.mock` — there is none, deliberately).
 *
 * H6/M3 below (task 8) also live in this file: search resetting pagination, the min/max
 * price fields being debounced too, and the decorative "Apply filters" button's removal.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ListingsPage from "./page";
import { AnnouncerProvider } from "@/components/ui/Announcer";

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

// The debounce mechanism itself is AC4's concern and has its own tests against the hook
// directly. It is intentionally left unmocked here (the real 400 ms hook runs): H6 and M3
// below assert on its effect — page reset and request coalescing — and no other test in
// this file changes `search`, `minPrice` or `maxPrice` after mount, so the real delay never
// costs the rest of the suite anything.

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

/**
 * The mocked `useFetch` above pushes its endpoint on every render, not only when the
 * endpoint actually changes — unlike the real hook, whose fetch effect is keyed on the
 * endpoint and only re-fires when it differs from the previous one (`useFetch.ts:99-122`).
 * Collapsing consecutive repeats restores that semantics, so a debounced value that
 * resolves to the same query across several re-renders reads as the one request it
 * actually is, matching what a real request count would show.
 */
const requestCount = () =>
  listingCalls().filter((url, index, all) => index === 0 || url !== all[index - 1]).length;

const lastQuery = () => listingCalls().at(-1) ?? "";

const toggle = () => screen.getByRole("checkbox", { name: /smart search/i });

function renderPage() {
  return render(
    <AnnouncerProvider>
      <ListingsPage />
    </AnnouncerProvider>,
  );
}

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

describe("L20 — the pager is hidden rather than stranded below the empty state", () => {
  it("renders no pager when there is one page of (zero) results", () => {
    fetchState.listings = page([]);
    render(<ListingsPage />);

    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /previous/i })).toBeNull();
    expect(screen.queryByText(/page \d+ of \d+/i)).toBeNull();
  });

  it("still renders the pager once there is more than one page", () => {
    fetchState.listings = { ...page([listing(1, "Aluminium mountain bike")]), totalPages: 2 };
    render(<ListingsPage />);

    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });

  it("L20 fix round 1 — a stale ?page= deep link clamps back to page 1 instead of stranding the user", async () => {
    // A bookmark or shared link to page 4, now that the result set is down to one page.
    // With the pager hidden (L20) and no clamp, this used to have no way back except
    // "Clear filters" -- which would also wipe the search term still in the URL.
    nav.params = new URLSearchParams("page=4&search=xyz");
    fetchState.listings = { ...page([listing(1, "Aluminium mountain bike")]), totalPages: 1 };

    renderPage();

    await waitFor(() => expect(lastQuery()).toContain("page=1"));
    expect(await screen.findByText("Aluminium mountain bike")).toBeInTheDocument();
    // The search term survives the clamp -- only `page` was stale, not the whole filter set.
    expect(lastQuery()).toContain("search=xyz");
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
    // `toMatch(/flex/)` also matched `min-w-0` in the same class list, so this could not
    // fail for the regression the comment above describes.
    expect(wrapper!.className.split(/\s+/)).toContain("flex");
  });
});

describe("H6 — searching resets pagination", () => {
  it("returns to page 1 when the search term changes", async () => {
    // Two pages available, so "Next" is enabled and page 2 is reachable. The default
    // fixture reports a single page, which would leave the button disabled.
    fetchState.listings = { ...page([listing(1, "Aluminium mountain bike")]), totalPages: 2 };

    const user = userEvent.setup();
    renderPage();

    // Go to page 2, then search. The bug: the query kept page=2 against a result set
    // with one page, so the grid was empty under a pager reading "Page 2 of 1".
    await user.click(await screen.findByRole("button", { name: /next/i }));
    await waitFor(() => expect(lastQuery()).toContain("page=2"));

    await user.type(screen.getByLabelText(/^search/i), "jacket");

    await waitFor(() => expect(lastQuery()).toContain("search=jacket"), { timeout: 2000 });
    expect(lastQuery()).toContain("page=1");
  });
});

describe("M3 — price filters are debounced", () => {
  it("issues one request for a four-keystroke price, not four", async () => {
    const user = userEvent.setup();
    renderPage();
    const before = requestCount();

    await user.type(screen.getByLabelText(/min price/i), "1000");

    // Each keystroke used to produce a request, a router.replace and a skeleton flash.
    await waitFor(() => expect(lastQuery()).toContain("minPrice=1000"), { timeout: 2000 });
    expect(requestCount() - before).toBeLessThanOrEqual(2);
  });
});

describe("M3 — the decorative submit button is gone", () => {
  it("offers no Apply filters button, because filters apply live", async () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /apply filters/i })).toBeNull();
    expect(await screen.findByRole("button", { name: /clear/i })).toBeInTheDocument();
  });
});

describe("C3 — results are announced", () => {
  it("announces the result count after a search settles", async () => {
    // The mocked useFetch returns the same one-row fixture (total: 1) regardless of the
    // search term, so this can't actually exercise "after a search settles" -- the
    // announce effect fires on `!loading && data`, which is already true at mount, and
    // `/\d+ listings? found/` would match any count including a stale one. Assert the
    // exact count against the fixture's `total` instead, which fails if the effect stops
    // firing or the count goes wrong.
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^search/i), "jacket");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 listing found"),
    );
  });
});

describe("L9 — sort is validated, not cast", () => {
  it("falls back to the default sort for an unknown value in the URL", async () => {
    // Previously cast, so the dropdown read "Newest" while the query asked for
    // "oldest" — a sort the server doesn't recognise either.
    nav.params = new URLSearchParams("sort=oldest");
    renderPage();

    expect(await screen.findByLabelText(/sort/i)).toHaveValue("newest");
    await waitFor(() => expect(lastQuery()).toContain("sort=newest"));
  });

  it("keeps a recognised sort value from the URL", async () => {
    nav.params = new URLSearchParams("sort=price_asc");
    renderPage();

    expect(await screen.findByLabelText(/sort/i)).toHaveValue("price_asc");
    await waitFor(() => expect(lastQuery()).toContain("sort=price_asc"));
  });
});

describe("H8 — the browse page has a heading hierarchy", () => {
  it("has exactly one h1", async () => {
    renderPage();
    const h1s = await screen.findAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(/browse listings/i);
  });

  it("names both landmark regions", async () => {
    renderPage();
    expect(await screen.findByRole("region", { name: /filters/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /results/i })).toBeInTheDocument();
  });
});
