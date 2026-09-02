// ─── Types ────────────────────────────────────────────────────────────────────

export type EmptyStateProps = {
  /** Rendered inside the rounded icon tile — usually a Remix icon. */
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
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      {/* Decorative icon tile, not content — contrast-exempt. */}
      <span
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400"
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-lg font-semibold text-zinc-700">{title}</p>
      {description && (
        <p className="text-sm text-zinc-500 max-w-xs">{description}</p>
      )}
      {action}
    </div>
  );
}
