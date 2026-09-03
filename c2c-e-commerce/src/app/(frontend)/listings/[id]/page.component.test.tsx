/**
 * H5 spec — the listing detail page reflects the purchase that just happened.
 *
 * Before this fix `isForSale` kept reading the status fetched *before* the mutation, so
 * the "Order placed successfully" banner sat above a still-live Buy Now button, and a
 * lost race (409) left the page saying `active` forever with no hint to reload.
 *
 * This is the page's first test file, so the harness below is also the first place that
 * exercises Task 3's untested JSX change: the `$`/price split that is now a single
 * `formatPrice(listing.price)` call.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnnouncerProvider } from "@/components/ui/Announcer";
import { ApiError } from "@/lib/api";
import type { ListingDetail } from "@/types/api";

import ListingDetailPage from "./page";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "7" }),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, email: "buyer@example.test", name: "Buyer", role: "buyer" },
    loading: false,
    isAuthenticated: true,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  onAuthLost: vi.fn(),
}));

// `importOriginal` matters here: the page imports the real `ApiError` class to branch on
// `err.status`, and this test constructs failures with `new ApiError(...)` too. Both must
// be the same class, so only `api` is replaced -- everything else the module exports
// (ApiError included) passes through untouched.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: apiMock };
});

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const BASE_LISTING: ListingDetail = {
  id: 7,
  title: "Vintage film camera",
  description: "Well loved, works perfectly.",
  price: "120.00",
  status: "active",
  sellerId: 99,
  categoryId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  // Unlike `createdAt`, `Serialized<T>` does not touch `updatedAt` -- it stays a `Date`
  // on the client-side `Listing` type (see src/types/api.ts).
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  coverImageId: null,
  sellerName: "Jane Seller",
  sellerAvatarUrl: null,
  sellerReviewCount: 3,
  sellerRatingSum: 12,
  categoryName: null,
  images: [],
};

/**
 * What the listing endpoint (`/api/listings/7`) resolves to from here on. The page also
 * fires `api.get` for `/api/categories` and, once loaded, `/api/listings/7/similar` --
 * routing on the endpoint (rather than queuing raw `mockResolvedValueOnce` calls in call
 * order) is what keeps those two from stealing a value meant for the listing itself.
 *
 * Calling `mockListing` again before a refetch is how a test answers `active` on the
 * first load and `reserved` once the page re-fetches after the purchase.
 */
let currentListing: ListingDetail = BASE_LISTING;

function mockListing(overrides: Partial<ListingDetail> = {}) {
  currentListing = { ...BASE_LISTING, ...overrides };
}

/**
 * Rejects the next order POST with a real `ApiError` carrying `status`. A plain `Error`
 * would not exercise the 409 branch under test, which reads `err.status`.
 */
function mockOrderFailure(status: number, message: string) {
  apiMock.post.mockRejectedValueOnce(new ApiError(message, status, new Headers()));
}

function renderPage() {
  return render(
    <AnnouncerProvider>
      <ListingDetailPage />
    </AnnouncerProvider>,
  );
}

/**
 * Finds text in the page proper, excluding the announcer's live regions.
 *
 * AnnouncerProvider deliberately renders a copy of every announced message into an
 * aria-live region, so any text that is both displayed and announced now matches twice.
 * Filtering on aria-live is structural; matching on the announcer's zero-width-space
 * suffix is not, because that suffix alternates per call and is absent on every second
 * announcement to the same region.
 */
function getInPage(text: string | RegExp): HTMLElement {
  const matches = screen
    .getAllByText(text)
    .filter((element) => element.closest("[aria-live]") === null);

  expect(matches).toHaveLength(1);
  return matches[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  currentListing = BASE_LISTING;

  apiMock.get.mockImplementation((endpoint: string) => {
    if (endpoint === "/api/listings/7") return Promise.resolve(currentListing);
    if (endpoint === "/api/categories") return Promise.resolve([]);
    if (endpoint.startsWith("/api/listings/7/similar")) return Promise.resolve([]);
    return Promise.reject(new Error(`Unexpected GET ${endpoint}`));
  });
  apiMock.post.mockResolvedValue({ id: 501 });

  // `useCurrencyConversion` calls the real, global `fetch` (not `@/lib/api`) to load
  // exchange rates. Nothing under test depends on it resolving, and a component test has
  // no business making a real network call.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("network disabled in tests")),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the price this page renders (Task 3 regression check)", () => {
  it("renders the price as a single '$120.00' string, with no stray space between the symbol and the amount", async () => {
    mockListing({ status: "active" });
    renderPage();

    // The price is the asking-price panel's figure now, not a "Price: …" line in a
    // paragraph — but what this test is actually guarding is `formatPrice`, so it
    // still asserts the exact rendered string rather than the label around it.
    expect(await screen.findByText("Asking price")).toBeInTheDocument();
    const price = screen.getByText("$120.00");
    expect(price.textContent).toBe("$120.00");
    // toHaveTextContent normalises whitespace, so it alone would not catch "$ 120.00".
    // This is the assertion that actually distinguishes the two.
    expect(price.textContent).not.toMatch(/\$\s+120/);
  });
});

describe("H5 — the page reflects the purchase that just happened", () => {
  it("stops offering Buy Now once the order is placed", async () => {
    const user = userEvent.setup();
    // First load: active. After the POST, the refetch answers `reserved`.
    mockListing({ status: "active" });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Buy Now" }));
    mockListing({ status: "reserved" });
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Buy Now" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "View order" })).toBeInTheDocument();
  });

  it("tells the user to reload when someone else won the race", async () => {
    const user = userEvent.setup();
    mockListing({ status: "active" });
    mockOrderFailure(409, "This listing has just been reserved by another buyer");
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Buy Now" }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    // Wait for the state update to settle before the synchronous `getInPage` lookup.
    await screen.findByRole("button", { name: /refresh listing/i });

    // The server's prose reaches the user intact, and the page offers a way forward
    // rather than leaving them to press a button that can only 409 again.
    //
    // `getInPage`, not a bare `findByText`: `AnnouncerProvider`'s own assertive live
    // region (also `role="alert"`) carries this same message, so a substring regex
    // matches both. Scoping past `[aria-live]` is what disambiguates them.
    expect(
      getInPage(/has just been reserved by another buyer/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh listing/i })).toBeInTheDocument();
  });

  it("does not offer a refresh action for an ordinary failure", async () => {
    const user = userEvent.setup();
    mockListing({ status: "active" });
    mockOrderFailure(500, "Something went wrong");
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Buy Now" }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    // Wait for the state update to settle before the synchronous `getInPage` lookup.
    // `getAllByText` (not `findByText`/`getByText`) so this doesn't itself throw on the
    // announcer's duplicate once it lands.
    await waitFor(() =>
      expect(screen.getAllByText(/something went wrong/i).length).toBeGreaterThan(0),
    );

    expect(getInPage(/something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh listing/i })).toBeNull();
  });
});
