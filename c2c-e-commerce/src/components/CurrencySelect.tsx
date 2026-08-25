"use client";

import { useId } from "react";
import type { useCurrencyConversion } from "@/hooks/useCurrencyConversion";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CurrencySelectProps = {
  /** The return value of `useCurrencyConversion()` from the calling page. */
  conversion: ReturnType<typeof useCurrencyConversion>;
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
    <div className={["flex flex-col gap-1", className].filter(Boolean).join(" ")}>
      <label className="text-sm font-medium text-zinc-700" htmlFor={id}>
        {label}
      </label>

      <select
        id={id}
        value={selectedCurrency}
        onChange={(event) => setSelectedCurrency(event.target.value)}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
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
        <p id={`${id}-error`} className="text-xs text-red-500">
          {ratesError}
        </p>
      )}
    </div>
  );
}
