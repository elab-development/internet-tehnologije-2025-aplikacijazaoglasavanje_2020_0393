// ─── Types ────────────────────────────────────────────────────────────────────

export type ErrorAlertProps = {
  message: string;
  /** Extra classes for spacing at the call site (e.g. `mb-4`). */
  className?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

/** The standard inline error banner used by every page that loads data. */
export default function ErrorAlert({ message, className = "" }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className={[
        "flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="shrink-0 mt-0.5" aria-hidden="true">
        ⚠️
      </span>
      <span>{message}</span>
    </div>
  );
}
