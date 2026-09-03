import { describe, it, expect } from "vitest";
import { parseBoundedInt, parseResourceId } from "./params";

describe("parseResourceId", () => {
  it("parses a positive integer", () => {
    expect(parseResourceId("42")).toBe(42);
    expect(parseResourceId("1")).toBe(1);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseResourceId(" 42 ")).toBe(42);
  });

  it("rejects zero and negatives, which no serial id can be", () => {
    expect(parseResourceId("0")).toBeNull();
    expect(parseResourceId("-1")).toBeNull();
    expect(parseResourceId("-999")).toBeNull();
  });

  it("rejects prefix-parsable junk", () => {
    // parseInt would read these as 7, 1 and 12 respectively.
    expect(parseResourceId("7abc")).toBeNull();
    expect(parseResourceId("1e5")).toBeNull();
    expect(parseResourceId("12.9")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    for (const raw of ["", "   ", "abc", "null", "undefined", "NaN", "Infinity"]) {
      expect(parseResourceId(raw)).toBeNull();
    }
  });

  it("rejects missing input", () => {
    expect(parseResourceId(undefined)).toBeNull();
    expect(parseResourceId(null)).toBeNull();
  });

  it("rejects ids beyond safe integer precision", () => {
    expect(parseResourceId("9007199254740993")).toBeNull();
  });

  it("rejects a signed-positive form rather than guessing", () => {
    expect(parseResourceId("+5")).toBeNull();
  });
});

describe("parseBoundedInt", () => {
  const opts = { fallback: 20, max: 100 };

  it("parses a plain integer", () => {
    expect(parseBoundedInt("42", opts)).toBe(42);
  });

  it("falls back when absent", () => {
    expect(parseBoundedInt(null, opts)).toBe(20);
    expect(parseBoundedInt(undefined, opts)).toBe(20);
    expect(parseBoundedInt("", opts)).toBe(20);
  });

  // The idiom this replaces was `parseInt(raw) || fallback`, which is prefix-tolerant:
  // "7abc" became 7, and a security boundary must not quietly reinterpret input.
  it.each(["7abc", "abc", "1.5", "0x10", " ", "-"])(
    "falls back rather than reinterpreting %o",
    (raw) => {
      expect(parseBoundedInt(raw, opts)).toBe(20);
    },
  );

  it("clamps to max", () => {
    expect(parseBoundedInt("1000", opts)).toBe(100);
  });

  it("clamps to min, which defaults to 1", () => {
    expect(parseBoundedInt("0", opts)).toBe(1);
    expect(parseBoundedInt("-5", opts)).toBe(1);
    expect(parseBoundedInt("0", { ...opts, min: 0 })).toBe(0);
  });
});
