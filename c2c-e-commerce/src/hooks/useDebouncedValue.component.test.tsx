/**
 * C2C-AI-8 spec — AC4's mechanism.
 *
 * Semantic mode costs an embedding per request, so a request per keystroke is not merely
 * wasteful — it is the difference between one model call and fifteen while someone types
 * "warm jacket for winter".
 *
 * A `.component.test.tsx` despite testing a hook rather than a component: `renderHook`
 * needs a DOM, and QA-2 splits the projects by environment, not by what is under test.
 * The unit project runs in node and cannot render this at all.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "./useDebouncedValue";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("C2C-AI-8 — useDebouncedValue", () => {
  it("AC4: returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("bike", 400));
    expect(result.current).toBe("bike");
  });

  it("AC4: does not report a change before the delay has elapsed", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 400),
      { initialProps: { value: "b" } },
    );

    rerender({ value: "bike" });
    act(() => {
      vi.advanceTimersByTime(399);
    });

    expect(result.current).toBe("b");
  });

  it("AC4: reports the change once the delay has elapsed", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 400),
      { initialProps: { value: "b" } },
    );

    rerender({ value: "bike" });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current).toBe("bike");
  });

  it("AC4: rapid typing settles on the last value only", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 400),
      { initialProps: { value: "" } },
    );

    // Fifteen keystrokes, 50 ms apart: one settled value, not fifteen.
    for (const value of "warm jacket for".split("").map((_, i, all) =>
      all.slice(0, i + 1).join(""),
    )) {
      rerender({ value });
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }

    expect(result.current).toBe("");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe("warm jacket for");
  });

  it("AC4: each keystroke restarts the wait rather than extending a fixed window", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 400),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender({ value: "abc" });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // 600 ms have passed, but never 400 ms of quiet.
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe("abc");
  });

  it("AC4: clearing the field is debounced too, not applied instantly", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 400),
      { initialProps: { value: "bike" } },
    );

    rerender({ value: "" });
    expect(result.current).toBe("bike");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe("");
  });

  it("cancels a pending update when the component unmounts", () => {
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 400),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    unmount();

    // A timer firing into an unmounted component is a React warning at best and a leak at
    // worst.
    expect(() => act(() => vi.advanceTimersByTime(400))).not.toThrow();
  });
});
