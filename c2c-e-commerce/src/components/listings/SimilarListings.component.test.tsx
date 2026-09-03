/**
 * C2C-AI-9 spec — AC8 and AC9, the "Similar listings" section.
 *
 * The section is fed by `useFetch`, which is mocked here: what is under test is what the
 * component renders for each response shape, not the hook, which has its own tests.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SimilarListings from "./SimilarListings";

const fetchState = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  error: null as string | null,
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

const row = (id: number, title: string, similarity = 0.8) => ({
  id,
  title,
  price: "120.00",
  coverImageId: null,
  status: "active",
  categoryId: 1,
  similarity,
});

beforeEach(() => {
  fetchState.data = null;
  fetchState.loading = false;
  fetchState.error = null;
});

describe("C2C-AI-9 — AC8: the section renders", () => {
  it("AC8: shows a heading when there are similar listings", () => {
    fetchState.data = [row(2, "Second-hand road bicycle")];
    render(<SimilarListings listingId={1} />);

    expect(screen.getByRole("heading", { name: /similar/i })).toBeInTheDocument();
  });

  it("AC8: renders a card per listing", () => {
    fetchState.data = [row(2, "Second-hand road bicycle"), row(3, "Children's BMX bike")];
    render(<SimilarListings listingId={1} />);

    expect(screen.getByText("Second-hand road bicycle")).toBeInTheDocument();
    expect(screen.getByText("Children's BMX bike")).toBeInTheDocument();
  });

  it("AC8: each card links to its listing", () => {
    fetchState.data = [row(7, "Gravel bike, carbon fork")];
    render(<SimilarListings listingId={1} />);

    const link = screen.getByRole("link", { name: /gravel bike/i });
    expect(link).toHaveAttribute("href", "/listings/7");
  });

  it("AC8: an anonymous visitor sees it — the section takes no user", () => {
    // The endpoint is public and so is the section: nothing here reads auth state.
    fetchState.data = [row(2, "Second-hand road bicycle")];
    render(<SimilarListings listingId={1} />);

    expect(screen.getByText("Second-hand road bicycle")).toBeInTheDocument();
  });

  it("shows the price so a card is useful without a click", () => {
    fetchState.data = [row(2, "Second-hand road bicycle")];
    render(<SimilarListings listingId={1} />);

    expect(screen.getByText(/120/)).toBeInTheDocument();
  });

  it("renders the price with a currency symbol, like every other surface", () => {
    // Regression: this strip rendered "120.00" while /listings rendered "$120.00"
    // for the same listing. getByText(/120/) matched both, which is why it survived.
    fetchState.data = [row(2, "Second-hand road bicycle")];
    render(<SimilarListings listingId={1} />);

    expect(screen.getByText("$120.00")).toBeInTheDocument();
  });
});

describe("C2C-AI-9 — AC9: the section hides itself", () => {
  it("AC9: an empty array renders nothing at all", () => {
    fetchState.data = [];
    const { container } = render(<SimilarListings listingId={1} />);

    // Not an empty heading, not a "no results" message — nothing. An empty section is
    // visual noise on a page that already has plenty.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("heading", { name: /similar/i })).not.toBeInTheDocument();
  });

  it("AC9: renders nothing before the first response arrives", () => {
    fetchState.loading = true;
    const { container } = render(<SimilarListings listingId={1} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("AC9: renders nothing when the request fails", () => {
    // A recommendation strip failing is not worth an error banner on a page whose main
    // content loaded fine.
    fetchState.error = "Network error";
    const { container } = render(<SimilarListings listingId={1} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("AC9: renders nothing when the response is not an array", () => {
    fetchState.data = { error: "Listing not found" };
    const { container } = render(<SimilarListings listingId={1} />);

    expect(container).toBeEmptyDOMElement();
  });
});
