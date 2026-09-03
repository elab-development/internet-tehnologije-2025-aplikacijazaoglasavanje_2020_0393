/**
 * Recognising a Postgres unique violation through Drizzle's wrapper.
 *
 * This is a two-line function that has already been got wrong once. Drizzle does not
 * rethrow the driver's error; it wraps it, so `code` and `constraint` are on `.cause`.
 * Written the obvious way the branch never matches, every happy-path test still passes,
 * and the 500 it was meant to replace survives in production.
 */
import { describe, expect, it } from "vitest";

import { isUniqueViolation } from "./pg-errors";

const INDEX = "widgets_one_per_thing_idx";

/** What `pg` throws. */
const driverError = (constraint: string) =>
  Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });

/** What Drizzle hands the caller. */
const wrapped = (cause: unknown) =>
  Object.assign(new Error("Failed query"), { cause });

describe("isUniqueViolation", () => {
  it("recognises the driver's own error", () => {
    expect(isUniqueViolation(driverError(INDEX), INDEX)).toBe(true);
  });

  it("recognises it one level down, where Drizzle actually puts it", () => {
    expect(isUniqueViolation(wrapped(driverError(INDEX)), INDEX)).toBe(true);
  });

  it("does not match a different index", () => {
    // Two unique indexes on one table would otherwise map to the same status code and
    // the same message, which is worse than a 500.
    expect(isUniqueViolation(wrapped(driverError("some_other_idx")), INDEX)).toBe(false);
  });

  it("does not match a different Postgres error on the right index", () => {
    const notNull = Object.assign(new Error("null value"), {
      code: "23502",
      constraint: INDEX,
    });
    expect(isUniqueViolation(wrapped(notNull), INDEX)).toBe(false);
  });

  it("is safe on anything at all", () => {
    for (const value of [null, undefined, "boom", 42, new Error("plain"), {}]) {
      expect(isUniqueViolation(value, INDEX)).toBe(false);
    }
  });
});
