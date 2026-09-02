import type { ReactNode } from "react";

export type AuthPageShellProps = {
  /** The badge icon above the title — each page's own (store, links, …). */
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Rendered under the form — the "already have an account?" line, or a cancel link. */
  footer?: ReactNode;
  /**
   * Extra classes for the outer centering wrapper. Register's form is taller than the
   * others', so it adds `py-10` here rather than everyone carrying padding they don't
   * need.
   */
  wrapperClassName?: string;
  /**
   * Extra classes for the icon/title/subtitle block. link-account's subtitle runs two
   * lines, so it tightens this to `mb-6` instead of the default `mb-8`.
   */
  headerClassName?: string;
};

/**
 * The card shell shared by /login, /register and /link-account (L6).
 *
 * All three copy-pasted the same centered, bordered card with an icon badge, a title,
 * a subtitle and a footer slot, and only ever changed the icon, the copy, the form in
 * the middle and two spacing classes. Those four became props; everything else
 * (the card's border/radius/shadow, the badge's size and color) is common and lives
 * here once.
 */
export default function AuthPageShell({
  icon,
  title,
  subtitle,
  children,
  footer,
  wrapperClassName,
  headerClassName,
}: AuthPageShellProps) {
  return (
    <div
      className={[
        "flex min-h-[calc(100vh-10rem)] items-center justify-center px-4",
        wrapperClassName,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <div
            className={[
              "flex flex-col items-center gap-2 text-center",
              headerClassName ?? "mb-8",
            ].join(" ")}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
              {icon}
            </span>
            <h1 className="text-2xl font-bold text-zinc-900">{title}</h1>
            <p className="text-sm text-zinc-500">{subtitle}</p>
          </div>

          {children}

          {footer}
        </div>
      </div>
    </div>
  );
}
