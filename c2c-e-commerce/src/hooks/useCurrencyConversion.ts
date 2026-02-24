"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULT_CURRENCIES = ["USD", "EUR", "GBP", "RSD"] as const;

type RatesResponse = {
  rates?: Record<string, number>;
};

export function useCurrencyConversion() {
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 });
  const [selectedCurrency, setSelectedCurrency] = useState<string>("USD");
  const [loadingRates, setLoadingRates] = useState(true);
  const [ratesError, setRatesError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadRates() {
      setLoadingRates(true);
      setRatesError(null);

      try {
        const response = await fetch("https://open.er-api.com/v6/latest/USD");
        if (!response.ok) {
          throw new Error(`Failed to load exchange rates (${response.status})`);
        }

        const data = (await response.json()) as RatesResponse;
        if (!data.rates || typeof data.rates !== "object") {
          throw new Error("Unexpected exchange rates response");
        }

        if (!alive) return;
        setRates({ USD: 1, ...data.rates });
      } catch (err: unknown) {
        if (!alive) return;
        setRatesError(err instanceof Error ? err.message : "Failed to load exchange rates");
      } finally {
        if (alive) setLoadingRates(false);
      }
    }

    loadRates();

    return () => {
      alive = false;
    };
  }, []);

  const availableCurrencies = useMemo(() => {
    return DEFAULT_CURRENCIES.filter((currency) => Boolean(rates[currency]));
  }, [rates]);

  function convertFromUsd(amountUsd: number): number {
    const rate = rates[selectedCurrency] ?? 1;
    return amountUsd * rate;
  }

  function formatConverted(amountUsd: number): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: selectedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(convertFromUsd(amountUsd));
  }

  return {
    selectedCurrency,
    setSelectedCurrency,
    loadingRates,
    ratesError,
    availableCurrencies,
    convertFromUsd,
    formatConverted,
  };
}