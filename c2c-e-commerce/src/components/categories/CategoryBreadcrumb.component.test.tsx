/**
 * Part 1 spec — the ancestor breadcrumb on a listing.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CategoryBreadcrumb from "./CategoryBreadcrumb";
import type { Category } from "@/types/api";

const CATEGORIES = [
  { id: 1, name: "Electronics", slug: "electronics", description: null, parentId: null, path: "1", depth: 0, sortOrder: 0 },
  { id: 7, name: "Phones", slug: "phones", description: null, parentId: 1, path: "1.7", depth: 1, sortOrder: 0 },
  { id: 12, name: "Smartphones", slug: "smartphones", description: null, parentId: 7, path: "1.7.12", depth: 2, sortOrder: 0 },
] as Category[];

describe("CategoryBreadcrumb", () => {
  it("renders the whole chain root-first", () => {
    render(<CategoryBreadcrumb categories={CATEGORIES} categoryId={12} />);

    const links = screen.getAllByRole("link");

    expect(links.map((l) => l.textContent)).toEqual([
      "Electronics",
      "Phones",
      "Smartphones",
    ]);
  });

  it("links each ancestor to a filtered browse", () => {
    render(<CategoryBreadcrumb categories={CATEGORIES} categoryId={12} />);

    expect(screen.getByRole("link", { name: "Electronics" })).toHaveAttribute(
      "href",
      "/listings?categoryId=1",
    );
  });

  it("says Uncategorized when the listing has no category", () => {
    render(<CategoryBreadcrumb categories={CATEGORIES} categoryId={null} />);

    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("says Uncategorized when the category list has not loaded yet", () => {
    // The page fetches listing and categories separately; the first render has one and
    // not the other, and that must not throw.
    render(<CategoryBreadcrumb categories={[]} categoryId={12} />);

    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
  });
});
