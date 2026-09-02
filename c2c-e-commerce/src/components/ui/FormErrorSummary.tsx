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

  useEffect(() => {
    if (errors.length > 0) ref.current?.focus();
  }, [errors]);

  if (errors.length === 0) return null;

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="rounded-lg border border-red-200 bg-red-50 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
    >
      <p className="text-sm font-medium text-red-800">
        {errors.length} {errors.length === 1 ? "field needs" : "fields need"} attention
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700">
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
