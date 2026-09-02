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
      <div className={`flex flex-col gap-1 ${className}`}>
        <label
          htmlFor={id}
          className="text-sm font-medium text-zinc-700"
        >
          {label}
          {rest.required && (
            <span className="ml-0.5 text-red-500" aria-hidden="true">
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
            "rounded-lg border px-3 py-2 text-sm text-zinc-900 outline-none",
            "placeholder:text-zinc-400",
            "transition-colors duration-150",
            "focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20",
            error
              ? "border-red-400 focus:border-red-500 focus:ring-red-400/20"
              : "border-zinc-300",
            "disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400",
          ]
            .filter(Boolean)
            .join(" ")}
        />

        {error && (
          <p id={`${id}-error`} role="alert" className="text-xs text-red-500">
            {error}
          </p>
        )}
      </div>
    );
  }
);

InputField.displayName = "InputField";
export default InputField;
