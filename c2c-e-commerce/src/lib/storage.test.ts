/**
 * Part 2 spec — key generation and validation.
 *
 * The key is the only thing standing between a caller and the filesystem, so it is
 * generated here and never taken from the client. These tests run in the `unit` project:
 * no filesystem, no database.
 */
import { describe, expect, it } from "vitest";

import { isValidStorageKey, storageKey } from "./storage";

describe("storageKey", () => {
  it("builds a key under the given prefix with the given extension", () => {
    const key = storageKey("listings/42", "webp");

    expect(key).toMatch(/^listings\/42\/[0-9a-f]{32}\.webp$/);
  });

  it("never repeats", () => {
    const keys = new Set(Array.from({ length: 100 }, () => storageKey("listings/1", "webp")));

    expect(keys.size).toBe(100);
  });
});

describe("isValidStorageKey", () => {
  it("accepts a generated key", () => {
    expect(isValidStorageKey(storageKey("listings/7", "webp"))).toBe(true);
  });

  it.each([
    ["../../etc/passwd", "parent traversal"],
    ["listings/../7/a.webp", "traversal in the middle"],
    ["/listings/7/a.webp", "absolute path"],
    ["listings\\7\\a.webp", "backslash separator"],
    ["listings/7/a.webp" + String.fromCharCode(0) + ".txt", "embedded null byte"],
    ["listings/7/", "no filename"],
    ["", "empty"],
  ])("rejects %s (%s)", (key) => {
    expect(isValidStorageKey(key)).toBe(false);
  });
});
