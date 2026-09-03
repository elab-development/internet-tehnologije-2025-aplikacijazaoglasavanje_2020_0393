/**
 * Unit coverage for `parsePriceInput`, pinned directly rather than only through the
 * form. See ListingForm.component.test.tsx's "M6" describe block for the form-level
 * behaviour (a comma decimal reaching the submit payload, and the field-level error
 * for unparseable input).
 */
import { describe, expect, it } from "vitest";

import { parsePriceInput } from "./ListingForm";

describe("parsePriceInput", () => {
  it("parses a plain integer", () => {
    expect(parsePriceInput("220")).toBe(220);
  });

  it("parses a dot decimal", () => {
    expect(parsePriceInput("1500.5")).toBe(1500.5);
  });

  it("normalises a single comma decimal to a dot", () => {
    expect(parsePriceInput("1500,50")).toBe(1500.5);
  });

  it("trims surrounding whitespace", () => {
    expect(parsePriceInput("  19.99  ")).toBe(19.99);
  });

  it("accepts at most two decimal places", () => {
    expect(parsePriceInput("19.9")).toBe(19.9);
    expect(parsePriceInput("19.99")).toBe(19.99);
  });

  it("rejects more than two decimal places", () => {
    expect(parsePriceInput("19.999")).toBeNull();
  });

  it("rejects a second comma or dot", () => {
    expect(parsePriceInput("1,500,50")).toBeNull();
    expect(parsePriceInput("1.500.50")).toBeNull();
  });

  it("rejects negative numbers", () => {
    expect(parsePriceInput("-5")).toBeNull();
  });

  it("rejects non-numeric text", () => {
    expect(parsePriceInput("abc")).toBeNull();
  });

  it("rejects exponential notation", () => {
    expect(parsePriceInput("1e3")).toBeNull();
  });

  it("rejects a trailing decimal point with no digits after it", () => {
    expect(parsePriceInput("12.")).toBeNull();
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("   ")).toBeNull();
  });

  it("rejects a bare decimal point with no leading digit", () => {
    expect(parsePriceInput(".5")).toBeNull();
  });
});
