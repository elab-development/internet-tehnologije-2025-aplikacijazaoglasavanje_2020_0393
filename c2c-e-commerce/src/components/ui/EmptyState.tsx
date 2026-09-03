// ─── Types ────────────────────────────────────────────────────────────────────

export type EmptyStateProps = {
  /** Rendered inside the icon tile — usually a Remix icon. */
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** Optional call to action, e.g. a `<Button>`. */
  action?: React.ReactNode;
};

// ─── Component ────────────────────────────────────────────────────────────────

/** The "nothing here yet" placeholder shown in place of an empty collection. */
export default function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 border border-rule bg-surface px-6 py-20 text-center">
      {/* Decorative icon tile, not content — contrast-exempt. */}
      <span
        className="flex h-16 w-16 items-center justify-center bg-inset text-ink-3"
        aria-hidden="true"
      >
        {icon}
      </span>
      {/* Section-placeholder heading: semantic <h2>, not a styled paragraph. */}
      <h2 className="text-2xl text-ink">{title}</h2>
      {description && (
        <p className="max-w-xs text-sm text-ink-2">{description}</p>
      )}
      {action}
    </div>
  );
}
