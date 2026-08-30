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
  it("renders every category, nested", async () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Electronics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clothing" })).toBeInTheDocument();

    // Branches collapse by default (spec §3.5); expand Electronics to reach Phones.
    await userEvent.click(screen.getByRole("button", { name: "Expand Electronics" }));

    expect(screen.getByRole("button", { name: "Phones" })).toBeInTheDocument();
  });

  it("reports the chosen category", async () => {
    const onChange = vi.fn();
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Expand Electronics" }));
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

  it("keeps a branch collapsed by default, hiding its children", () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Electronics" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Phones" })).not.toBeInTheDocument();
  });

  it("reveals children when the branch's toggle is clicked", async () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Expand Electronics" }));

    expect(screen.getByRole("button", { name: "Phones" })).toBeInTheDocument();
  });

  it("starts expanded along the chain of the currently selected category", () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={7} onChange={vi.fn()} />);

    // Phones (id 7) is selected and sits under Electronics — that branch must already be
    // open, or the selected item would be invisible on load.
    expect(screen.getByRole("button", { name: "Phones" })).toBeInTheDocument();
  });

  it("reflects expanded state through aria-expanded", async () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: "Expand Electronics" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Collapse Electronics" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps the toggle a separate control from the selection button", async () => {
    const onChange = vi.fn();
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Expand Electronics" }));

    // Expanding must not also select — those are two different actions on two different
    // controls.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives no toggle to a leaf category", () => {
    render(<CategoryTreeFilter categories={CATEGORIES} value={null} onChange={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: /Expand Clothing|Collapse Clothing/ }),
    ).not.toBeInTheDocument();
  });
});
