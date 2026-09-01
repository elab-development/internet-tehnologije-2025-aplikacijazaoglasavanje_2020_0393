"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Announce = (message: string, options?: { assertive?: boolean }) => void;

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * `null` when no provider is mounted. `useAnnounce` degrades to a no-op rather than
 * throwing, so a component rendered in isolation by a test does not explode.
 */
const AnnouncerContext = createContext<Announce | null>(null);

const NOOP: Announce = () => {};

/**
 * The app's single pair of live regions.
 *
 * Mounted once, high in the tree, and never conditionally: a live region has to be in
 * the DOM *before* its content changes or screen readers miss the update entirely.
 * Per-component `aria-live` attributes fail exactly the debounced-search case that
 * motivates this — the region would appear at the same instant as its first message.
 */
export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  // Identical text is not a DOM change, so a repeated message would be silent. A
  // zero-width space alternates on each announcement to force one.
  const parity = useRef(false);

  const announce = useCallback<Announce>((message, options) => {
    parity.current = !parity.current;
    const text = parity.current ? `${message}\u200B` : message;
    if (options?.assertive) setAssertive(text);
    else setPolite(text);
  }, []);

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

/**
 * Announces a message to screen readers without changing anything on screen.
 *
 * ```tsx
 * const announce = useAnnounce();
 * announce(`${total} listings found`);
 * announce("Upload failed", { assertive: true });
 * ```
 *
 * Use `assertive` only for something the user must hear immediately — a failure that
 * interrupts what they were doing. Everything else is polite.
 */
export function useAnnounce(): Announce {
  return useContext(AnnouncerContext) ?? NOOP;
}
