/**
 * Part 1 spec — the cascading category picker.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CategorySelect from "./CategorySelect";
import type { Category } from "@/types/api";

const CATEGORIES = [
  { id: 1, name: "Electronics", slug: "electronics", description: null, parentId: null, path: "1", depth: 0, sortOrder: 0 },
  { id: 2, name: "Clothing", slug: "clothing", description: null, parentId: null, path: "2", depth: 0, sortOrder: 1 },
  { id: 7, name: "Phones", slug: "phones", description: null, parentId: 1, path: "1.7", depth: 1, sortOrder: 0 },
  { id: 12, name: "Smartphones", slug: "smartphones", description: null, parentId: 7, path: "1.7.12", depth: 2, sortOrder: 0 },
] as Category[];

describe("CategorySelect", () => {
  it("offers only root categories at the top level", () => {
    render(<CategorySelect categories={CATEGORIES} value={null} onChange={vi.fn()} />);

    const top = screen.getByLabelText("Category");

    expect(within(top).getByRole("option", { name: "Electronics" })).toBeInTheDocument();
    expect(within(top).queryByRole("option", { name: "Phones" })).not.toBeInTheDocument();
  });

  it("reveals the next level once a parent with children is chosen", async () => {
    const onChange = vi.fn();
    render(<CategorySelect categories={CATEGORIES} value={null} onChange={onChange} />);

    expect(screen.queryByLabelText("Subcategory")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Category"), "1");

    expect(onChange).toHaveBeenCalledWith(1);
    expect(screen.getByLabelText("Subcategory")).toBeInTheDocument();
  });

  it("shows no deeper select for a root with no children", async () => {
    const onChange = vi.fn();
    render(<CategorySelect categories={CATEGORIES} value={null} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText("Category"), "2");

    expect(onChange).toHaveBeenCalledWith(2);
    expect(screen.queryByLabelText("Subcategory")).not.toBeInTheDocument();
  });

  it("prefills every level from an existing deep value", () => {
    render(<CategorySelect categories={CATEGORIES} value={12} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Category")).toHaveValue("1");
    expect(screen.getByLabelText("Subcategory")).toHaveValue("7");
    expect(screen.getByLabelText("Sub-subcategory")).toHaveValue("12");
  });

  it("clears deeper levels when a higher one changes", async () => {
    const onChange = vi.fn();
    render(<CategorySelect categories={CATEGORIES} value={12} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText("Category"), "2");

    // Selecting a different root cannot leave the old grandchild selected underneath it.
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(screen.queryByLabelText("Subcategory")).not.toBeInTheDocument();
  });

  it("reports null when the top level is cleared", async () => {
    const onChange = vi.fn();
    render(<CategorySelect categories={CATEGORIES} value={1} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText("Category"), "");

    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
