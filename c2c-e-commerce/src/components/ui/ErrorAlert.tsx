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
        "flex items-start gap-3 border border-l-[6px] border-stop-rule border-l-stop bg-stop-tint px-4 py-3 text-sm text-stop-ink",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Was an emoji, which reads as a picture of a warning sign rather than one:
          screen readers announce it by its Unicode name, and it renders in whatever
          colour and shape the platform's font decides. */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="mt-0.5 h-[18px] w-[18px] shrink-0"
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 4.5 3.5 19h17Z" />
        <path d="M12 10v4" />
        <path d="M12 16.6v.4" />
      </svg>
      <span>{message}</span>
    </div>
  );
}
