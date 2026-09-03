/**
 * Part 1 spec — path arithmetic.
 *
 * Kept free of any database import so it runs in the `unit` project: these are the
 * rules every route and every component depends on, and they should be provable in
 * milliseconds.
 */
import { describe, expect, it } from "vitest";

import {
  ancestorChain,
  buildCategoryTree,
  childPath,
  childrenOf,
  depthOfPath,
  wouldCreateCycle,
  type CategoryLike,
} from "./categories";

/** Electronics(1) › Phones(7) › Smartphones(12); Clothing(2) is a second root. */
const ROWS: CategoryLike[] = [
  { id: 1, name: "Electronics", parentId: null, path: "1", sortOrder: 0 },
  { id: 7, name: "Phones", parentId: 1, path: "1.7", sortOrder: 0 },
  { id: 12, name: "Smartphones", parentId: 7, path: "1.7.12", sortOrder: 1 },
  { id: 13, name: "Feature phones", parentId: 7, path: "1.7.13", sortOrder: 0 },
  { id: 2, name: "Clothing", parentId: null, path: "2", sortOrder: 1 },
];

describe("childPath", () => {
  it("gives a root its own id", () => {
    expect(childPath(null, 4)).toBe("4");
  });

  it("appends to the parent's path", () => {
    expect(childPath("1.7", 12)).toBe("1.7.12");
  });
});

describe("depthOfPath", () => {
  it("counts roots as 0", () => {
    expect(depthOfPath("1")).toBe(0);
  });

  it("counts a grandchild as 2", () => {
    expect(depthOfPath("1.7.12")).toBe(2);
  });
});

describe("wouldCreateCycle", () => {
  it("rejects making a node its own parent", () => {
    expect(wouldCreateCycle("1.7", "1.7")).toBe(true);
  });

  it("rejects moving a node under its own descendant", () => {
    expect(wouldCreateCycle("1.7", "1.7.12")).toBe(true);
  });

  it("allows moving a node under an unrelated branch", () => {
    expect(wouldCreateCycle("1.7", "2")).toBe(false);
  });

  it("does not mistake a sibling with a shared id prefix for a descendant", () => {
    // '1.70' starts with '1.7' as a string but is not inside that subtree. Without the
    // separator in the comparison this returns true and legal moves are refused.
    expect(wouldCreateCycle("1.7", "1.70")).toBe(false);
  });
});

describe("childrenOf", () => {
  it("returns roots for a null parent, in sortOrder", () => {
    expect(childrenOf(ROWS, null).map((c) => c.id)).toEqual([1, 2]);
  });

  it("orders siblings by sortOrder, then name", () => {
    expect(childrenOf(ROWS, 7).map((c) => c.name)).toEqual([
      "Feature phones",
      "Smartphones",
    ]);
  });

  it("returns nothing for a leaf", () => {
    expect(childrenOf(ROWS, 12)).toEqual([]);
  });
});

describe("ancestorChain", () => {
  it("returns root-to-node inclusive", () => {
    expect(ancestorChain(ROWS, 12).map((c) => c.name)).toEqual([
      "Electronics",
      "Phones",
      "Smartphones",
    ]);
  });

  it("returns just the node for a root", () => {
    expect(ancestorChain(ROWS, 1).map((c) => c.name)).toEqual(["Electronics"]);
  });

  it("returns empty for an unknown id", () => {
    expect(ancestorChain(ROWS, 999)).toEqual([]);
  });
});

describe("buildCategoryTree", () => {
  it("nests children under their parent", () => {
    const tree = buildCategoryTree(ROWS);

    expect(tree.map((n) => n.name)).toEqual(["Electronics", "Clothing"]);
    expect(tree[0].children.map((n) => n.name)).toEqual(["Phones"]);
    expect(tree[0].children[0].children.map((n) => n.name)).toEqual([
      "Feature phones",
      "Smartphones",
    ]);
  });

  it("drops a node whose parent is absent rather than losing the whole tree", () => {
    // A partial fetch should degrade to fewer branches, not to a crash.
    const orphaned = ROWS.filter((r) => r.id !== 7);
    const tree = buildCategoryTree(orphaned);

    expect(tree.map((n) => n.name)).toEqual(["Electronics", "Clothing"]);
    expect(tree[0].children).toEqual([]);
  });
});
