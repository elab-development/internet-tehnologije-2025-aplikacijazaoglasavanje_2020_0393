"use client";

import { forwardRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

export type ButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> & {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  /**
   * Native tooltip. A disabled button that does not say why it is disabled is the
   * frustrating kind — C2C-AI-6 AC5 requires the explanation.
   *
   * Declared explicitly rather than inherited only so this note survives.
   */
  title?: string;
  /** Narrowed from the native `string` so a typo cannot silently become a submit. */
  type?: "button" | "submit" | "reset";
};

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Flat fills, square corners, no shadow. `primary` is ink at rest and black on
 * hover — the category hues are reserved for saying what something *is*, so an
 * action never borrows one to say what it *does*.
 *
 * `ghost` is the quiet variant: underlined text rather than a filled or outlined
 * box, so a page never shows three things that look equally like the main action.
 */
const variantClasses: Record<Variant, string> = {
  primary: "border-ink bg-ink text-white hover:border-black hover:bg-black",
  secondary:
    "border-ink bg-transparent text-ink hover:bg-ink hover:text-white",
  danger: "border-stop bg-transparent text-stop hover:bg-stop hover:text-white",
  ghost:
    "border-transparent bg-transparent text-ink-2 underline decoration-1 underline-offset-[3px] hover:text-ink hover:decoration-2",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-4 py-2 text-[11.5px] gap-2",
  md: "px-6 py-3 text-[13px] gap-2.5",
  lg: "px-7 py-4 text-sm gap-2.5",
};

// ─── Component ────────────────────────────────────────────────────────────────

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    icon,
    loading = false,
    disabled = false,
    type = "button",
    children,
    className = "",
    fullWidth = false,
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center rounded-none border-[1.5px]",
        "font-bold uppercase tracking-[0.06em]",
        "transition-colors duration-100",
        // No `outline-none` here: the square focus ring in globals.css is the one
        // the whole interface uses, and a button opting out of it was the only
        // control that needed its own ring classes.
        "disabled:cursor-not-allowed disabled:opacity-35",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {loading ? (
        // The one round thing in the interface, and only because a square spinner
        // does not read as spinning.
        <span
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        // Every current call site pairs `icon` with visible `children` text (L24):
        // the icon is decoration next to a labelled control, so it is hidden here once,
        // centrally, rather than at each of the eight call sites.
        icon && (
          <span className="shrink-0" aria-hidden="true">
            {icon}
          </span>
        )
      )}
      {children && <span>{children}</span>}
    </button>
  );
});

Button.displayName = "Button";
export default Button;
