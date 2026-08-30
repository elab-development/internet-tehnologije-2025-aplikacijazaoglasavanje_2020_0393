"use client";

import { useEffect, useState } from "react";
import { MAX_CATEGORY_DEPTH, ancestorChain, childrenOf } from "@/lib/categories";
import type { Category } from "@/types/api";

const LEVEL_LABELS = ["Category", "Subcategory", "Sub-subcategory"];

const selectClasses =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20";

export type CategorySelectProps = {
  categories: Category[];
  /** The deepest selected category, or null. */
  value: number | null;
  onChange: (id: number | null) => void;
};

/**
 * Cascading selects over the category tree.
 *
 * The selected chain is derived from `value` via the stored path — `value` stays the
 * single source of truth, the same one `ListingForm` holds. `localValue` is not a second,
 * independently-drifting copy of it: it is seeded from `value` and resynced by the effect
 * below whenever `value` changes externally (e.g. a different listing loads). It exists
 * only so a deeper level appears the instant it is chosen, without waiting on the
 * parent's state update to round-trip back down as a new prop.
 */
export default function CategorySelect({
  categories,
  value,
  onChange,
}: CategorySelectProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const chain = localValue === null ? [] : ancestorChain(categories, localValue);

  // One select per already-chosen level, plus one for the next choice if the deepest
  // selection still has children and we are not at the cap.
  const levels: { parentId: number | null; selected: number | null }[] = [];

  for (let depth = 0; depth < MAX_CATEGORY_DEPTH; depth++) {
    const parentId = depth === 0 ? null : (chain[depth - 1]?.id ?? null);

    // A level beyond the chosen chain only exists if its parent was chosen.
    if (depth > 0 && chain[depth - 1] === undefined) break;
    if (childrenOf(categories, parentId).length === 0) break;

    levels.push({ parentId, selected: chain[depth]?.id ?? null });
  }

  function handleChange(depth: number, raw: string) {
    // Changing any level discards everything below it: the old deeper selection is not
    // a descendant of the new choice.
    const next = raw === "" ? (depth === 0 ? null : (chain[depth - 1]?.id ?? null)) : Number(raw);
    setLocalValue(next);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {levels.map((level, depth) => {
        const id = `listing-category-${depth}`;
        const options = childrenOf(categories, level.parentId);

        return (
          <div key={id} className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700" htmlFor={id}>
              {LEVEL_LABELS[depth]}
            </label>
            <select
              id={id}
              className={selectClasses}
              value={level.selected === null ? "" : String(level.selected)}
              onChange={(event) => handleChange(depth, event.target.value)}
            >
              <option value="">
                {depth === 0 ? "No category" : `All ${LEVEL_LABELS[depth].toLowerCase()}`}
              </option>
              {options.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
