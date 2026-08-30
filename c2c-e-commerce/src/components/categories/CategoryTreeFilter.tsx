"use client";

import { useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";

import { ancestorChain, buildCategoryTree, type CategoryTreeNode } from "@/lib/categories";
import type { Category } from "@/types/api";

export type CategoryTreeFilterProps = {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
};

function itemClasses(selected: boolean): string {
  return [
    "w-full rounded-lg px-2 py-1 text-left text-sm transition-colors",
    selected
      ? "bg-indigo-50 font-medium text-indigo-700"
      : "text-zinc-700 hover:bg-zinc-100",
  ].join(" ");
}

function Branch({
  nodes,
  value,
  onChange,
  expanded,
  onToggle,
}: {
  nodes: CategoryTreeNode<Category>[];
  value: number | null;
  onChange: (id: number | null) => void;
  expanded: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expanded.has(node.id);

        return (
          <li key={node.id}>
            <div className="flex items-center gap-0.5">
              {hasChildren ? (
                // A separate control from the category button below: expanding a branch
                // and selecting a category are two different actions, and conflating them
                // would make it impossible to look under a category without also
                // filtering by it.
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.name}`}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                  onClick={() => onToggle(node.id)}
                >
                  {isExpanded ? (
                    <RiArrowDownSLine size={14} aria-hidden="true" />
                  ) : (
                    <RiArrowRightSLine size={14} aria-hidden="true" />
                  )}
                </button>
              ) : (
                <span className="h-5 w-5 shrink-0" aria-hidden="true" />
              )}
              <button
                type="button"
                className={itemClasses(node.id === value)}
                // aria-current rather than a class alone: the selection has to be
                // reachable by a screen reader, not only visible.
                aria-current={node.id === value ? "true" : undefined}
                onClick={() => onChange(node.id)}
              >
                {node.name}
              </button>
            </div>
            {hasChildren && isExpanded && (
              <div className="ml-3 border-l border-zinc-200 pl-2">
                <Branch
                  nodes={node.children}
                  value={value}
                  onChange={onChange}
                  expanded={expanded}
                  onToggle={onToggle}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The browse filter.
 *
 * Choosing a parent filters by the parent *and everything under it* — the server does
 * that expansion (spec §3.3), so this component only reports an id.
 *
 * Branches are collapsible (spec §3.5): with the seeded taxonomy an always-expanded tree
 * runs to ~17 stacked buttons in a form cell built for one. Collapse/expand is purely
 * local presentational state — it is not the selection, which stays controlled via
 * `value`/`onChange` like the rest of this component.
 */
export default function CategoryTreeFilter({
  categories,
  value,
  onChange,
}: CategoryTreeFilterProps) {
  const tree = buildCategoryTree(categories);

  // Collapsed by default, except along the chain of whatever is already selected — a
  // freshly loaded filter must not hide its own selection.
  const [expanded, setExpanded] = useState<Set<number>>(
    () =>
      new Set(
        (value === null ? [] : ancestorChain(categories, value)).map(
          (category) => category.id,
        ),
      ),
  );

  function toggle(id: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <nav aria-label="Categories" className="flex flex-col gap-1">
      <button
        type="button"
        className={itemClasses(value === null)}
        aria-current={value === null ? "true" : undefined}
        onClick={() => onChange(null)}
      >
        All categories
      </button>
      <Branch
        nodes={tree}
        value={value}
        onChange={onChange}
        expanded={expanded}
        onToggle={toggle}
      />
    </nav>
  );
}
