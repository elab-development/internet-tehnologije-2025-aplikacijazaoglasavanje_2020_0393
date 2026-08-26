import { describe, it, expect } from "vitest";
import { parseResourceId } from "./params";

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
