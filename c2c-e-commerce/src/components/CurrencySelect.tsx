"use client";

import { useId } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The slice of `useCurrencyConversion()`'s return value this component actually
 * renders. Declared as its own interface rather than `ReturnType<typeof
 * useCurrencyConversion>` (L10) — the hook's return also carries `convertFromUsd`
 * and `formatConverted`, which this component never touches, and coupling the prop
 * to the hook's whole shape meant any unrelated addition to the hook's return type
 * was a breaking change for this component's contract too.
 *
 * `useCurrencyConversion()`'s return value still satisfies this structurally, so no
 * caller changes.
 */
export type CurrencyControl = {
  selectedCurrency: string;
  setSelectedCurrency: (currency: string) => void;
  loadingRates: boolean;
  ratesError: string | null;
  availableCurrencies: readonly string[];
};

export type CurrencySelectProps = {
  /** The relevant slice of `useCurrencyConversion()` from the calling page. */
  conversion: CurrencyControl;
  label?: string;
  /** Extra classes for the wrapper, e.g. `sm:w-48`. */
  className?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Currency picker for the "convert price" affordance.
 *
 * The page owns the `useCurrencyConversion()` instance because it also needs
 * `formatConverted`; this component just renders the control bound to it.
 *
 * ```tsx
 * const conversion = useCurrencyConversion();
 * const { formatConverted } = conversion;
 * <CurrencySelect conversion={conversion} className="sm:w-48" />
 * ```
 */
export default function CurrencySelect({
  conversion,
  label = "Convert price",
  className = "",
}: CurrencySelectProps) {
  const id = useId();
  const {
    selectedCurrency,
    setSelectedCurrency,
    loadingRates,
    ratesError,
    availableCurrencies,
  } = conversion;

  return (
    <div className={["flex flex-col gap-2", className].filter(Boolean).join(" ")}>
      <label className="eyebrow text-ink-2" htmlFor={id}>
        {label}
      </label>

      <select
        id={id}
        value={selectedCurrency}
        onChange={(event) => setSelectedCurrency(event.target.value)}
        className="border-[1.5px] border-rule-strong bg-surface px-3.5 py-3 text-sm text-ink transition-colors focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--ink)] focus:outline-none"
        disabled={loadingRates}
        aria-describedby={ratesError ? `${id}-error` : undefined}
      >
        {availableCurrencies.map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </select>

      {ratesError && (
        <p id={`${id}-error`} className="text-xs text-stop">
          {ratesError}
        </p>
      )}
    </div>
  );
}
