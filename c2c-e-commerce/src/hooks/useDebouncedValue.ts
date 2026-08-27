"use client";

import { useEffect, useState } from "react";

/**
 * C2C-AI-8 — reports `value` only once it has stopped changing for `delayMs`.
 *
 * Semantic mode costs an embedding per request, so a request per keystroke is the
 * difference between one model call and fifteen while someone types "warm jacket for
 * winter".
 *
 * Each change restarts the wait rather than extending a fixed window: the cleanup clears
 * the pending timer, so 600 ms of steady typing with no 400 ms gap produces nothing. That
 * cleanup is also what stops a timer firing into an unmounted component.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
