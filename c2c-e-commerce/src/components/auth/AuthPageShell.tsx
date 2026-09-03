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
 * The centred column shared by /login, /register and /link-account (L6).
 *
 * All three copy-pasted the same centered card with an icon badge, a title, a
 * subtitle and a footer slot, and only ever changed the icon, the copy, the form in
 * the middle and two spacing classes. Those four became props; everything else lives
 * here once.
 *
 * The title block sits outside the panel rather than inside it: the panel is the
 * form, and a heading inside a bordered box reads as a section of a page rather
 * than the page itself. The brand mark is deliberately absent — the header bar
 * three rems above already carries it.
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
        "flex min-h-[calc(100vh-14rem)] items-center justify-center px-4",
        wrapperClassName,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="w-full max-w-md">
        <div
          className={[
            "flex flex-col items-center gap-3 text-center",
            headerClassName ?? "mb-7",
          ].join(" ")}
        >
          <span
            className="flex h-11 w-11 items-center justify-center bg-ink text-white"
            aria-hidden="true"
          >
            {icon}
          </span>
          <h1 className="text-4xl">{title}</h1>
          <p className="max-w-[42ch] text-sm text-ink-2">{subtitle}</p>
        </div>

        <div className="border-[1.5px] border-ink bg-surface p-8">
          {children}

          {footer}
        </div>
      </div>
    </div>
  );
}
