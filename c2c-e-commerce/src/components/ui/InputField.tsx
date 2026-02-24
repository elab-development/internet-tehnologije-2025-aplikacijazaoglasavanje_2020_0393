"use client";

import { forwardRef, useId } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type InputFieldProps = {
  label: string;
  type?: "text" | "email" | "password" | "number" | "tel" | "search";
  placeholder?: string;
  value: string | number;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  autoComplete?: string;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
};

// ─── Component ────────────────────────────────────────────────────────────────

const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  function InputField(
    {
      label,
      type = "text",
      placeholder,
      value,
      onChange,
      error,
      required = false,
      disabled = false,
      name,
      autoComplete,
      className = "",
      min,
      max,
      step,
    },
    ref
  ) {
    const id = useId();

    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <label
          htmlFor={id}
          className="text-sm font-medium text-zinc-700"
        >
          {label}
          {required && (
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>

        <input
          ref={ref}
          id={id}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          min={min}
          max={max}
          step={step}
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
