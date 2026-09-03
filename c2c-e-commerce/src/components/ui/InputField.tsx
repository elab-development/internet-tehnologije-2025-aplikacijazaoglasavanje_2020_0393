"use client";

import { forwardRef, useId } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

// M14 applied to InputField: a closed hand-written prop list forwarded no arbitrary
// attributes. Task 13 had to bolt on an `inputMode` passthrough for exactly this reason,
// and this task needed an `id` one — so the list is now everything native, minus the
// three the component fully owns.
export type InputFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  label: string;
  type?: "text" | "email" | "password" | "number" | "tel" | "search";
  value: string | number;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  error?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  function InputField(
    { label, type = "text", value, onChange, error, className = "", id: idProp, ...rest },
    ref
  ) {
    const generatedId = useId();
    const id = idProp ?? generatedId;

    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <label htmlFor={id} className="eyebrow text-ink-2">
          {label}
          {rest.required && (
            <span className="ml-0.5 text-stop" aria-hidden="true">
              *
            </span>
          )}
        </label>

        <input
          {...rest}
          ref={ref}
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={[
            "border-[1.5px] bg-surface px-3.5 py-3 text-sm text-ink",
            "placeholder:text-ink-3",
            "transition-colors duration-100",
            // A hard inset ring rather than a soft halo: this palette has no
            // shadows, and a blurred focus glow would be its only soft edge.
            error
              ? "border-stop focus:border-stop focus:shadow-[inset_0_0_0_1px_var(--stop)]"
              : "border-rule-strong focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--ink)]",
            "focus:outline-none",
            // Disabled control text — WCAG 1.4.3 exempts disabled elements from the
            // contrast requirement, contrast-exempt.
            "disabled:cursor-not-allowed disabled:bg-inset disabled:text-ink-3",
          ]
            .filter(Boolean)
            .join(" ")}
        />

        {error && (
          <p id={`${id}-error`} role="alert" className="text-xs font-medium text-stop-ink">
            {error}
          </p>
        )}
      </div>
    );
  }
);

InputField.displayName = "InputField";
export default InputField;
