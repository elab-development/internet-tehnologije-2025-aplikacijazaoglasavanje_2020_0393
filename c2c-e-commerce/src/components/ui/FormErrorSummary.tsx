"use client";

import { useEffect, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldError = { field: string; message: string };

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * One summary for a form's validation failures.
 *
 * A blank submit used to fire one `role="alert"` per invalid field simultaneously —
 * they queue or clobber each other, so a screen reader user heard one message or a
 * fragment, with no idea how many fields had failed. This is rendered above the form —
 * where a keyboard user tabbing forward would never reach it — so it takes focus when
 * it appears, and lists a link to every failed field in one place.
 *
 * Additive, not a replacement: per-field errors (already wired through
 * `aria-describedby` on `InputField`) stay in place.
 */
export default function FormErrorSummary({ errors }: { errors: FieldError[] }) {
  const ref = useRef<HTMLDivElement>(null);

  // Keyed on content, not array identity: a caller that builds the error list inline
  // would otherwise hand us a new array every render and re-steal focus on each one,
  // pulling the cursor out of whatever the user was typing. All three current callers
  // happen to store the array in state (a stable reference across keystroke re-renders),
  // but that's a convention on the caller's side, not a guarantee this component can rely
  // on.
  const signature = errors.map((e) => `${e.field}:${e.message}`).join("|");

  useEffect(() => {
    if (errors.length > 0) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (errors.length === 0) return null;

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="rounded-none border border-stop-rule bg-stop-tint p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-stop"
    >
      <p className="text-sm font-medium text-stop-ink">
        {errors.length} {errors.length === 1 ? "field needs" : "fields need"} attention
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-stop-ink">
        {errors.map((error) => (
          <li key={error.field}>
            <a href={`#${error.field}`} className="underline">
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
