"use client";

import { buildCategoryTree, type CategoryTreeNode } from "@/lib/categories";
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
}: {
  nodes: CategoryTreeNode<Category>[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            className={itemClasses(node.id === value)}
            // aria-current rather than a class alone: the selection has to be reachable
            // by a screen reader, not only visible.
            aria-current={node.id === value ? "true" : undefined}
            onClick={() => onChange(node.id)}
          >
            {node.name}
          </button>
          {node.children.length > 0 && (
            <div className="ml-3 border-l border-zinc-200 pl-2">
              <Branch nodes={node.children} value={value} onChange={onChange} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The browse filter.
 *
 * Choosing a parent filters by the parent *and everything under it* — the server does
 * that expansion (spec §3.3), so this component only reports an id.
 */
export default function CategoryTreeFilter({
  categories,
  value,
  onChange,
}: CategoryTreeFilterProps) {
  const tree = buildCategoryTree(categories);

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
      <Branch nodes={tree} value={value} onChange={onChange} />
    </nav>
  );
}
