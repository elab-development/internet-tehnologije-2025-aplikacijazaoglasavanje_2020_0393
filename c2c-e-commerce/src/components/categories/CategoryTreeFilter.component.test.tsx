/**
 * Part 1 spec — the browse-page category tree.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CategoryTreeFilter from "./CategoryTreeFilter";
import type { Category } from "@/types/api";

const CATEGORIES = [
  { id: 1, name: "Electronics", slug: "electronics", description: null, parentId: null, path: "1", depth: 0, sortOrder: 0 },
  { id: 2, name: "Clothing", slug: "clothing", description: null, parentId: null, path: "2", depth: 0, sortOrder: 1 },
  { id: 7, name: "Phones", slug: "phones", description: null, parentId: 1, path: "1.7", depth: 1, sortOrder: 0 },
] as Category[];

describe("CategoryTreeFilter", () => {
  it("renders every category, nested", () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Electronics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phones" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clothing" })).toBeInTheDocument();
  });

  it("reports the chosen category", async () => {
    const onChange = vi.fn();
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Phones" }));

    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("marks the selected category", () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={7} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Phones" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Electronics" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("clears the filter through All categories", async () => {
    const onChange = vi.fn();
    render(<CategoryTreeFilter categories={CATEGORIES} value={7} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "All categories" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
