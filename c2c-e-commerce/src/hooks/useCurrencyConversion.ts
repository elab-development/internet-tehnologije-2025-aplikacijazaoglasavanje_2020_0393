"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULT_CURRENCIES = ["USD", "EUR", "GBP", "RSD"] as const;

const RATES_URL = "https://open.er-api.com/v6/latest/USD";
const RATES_TIMEOUT_MS = 8000;
/** Rates move slowly; four pages refetching them on every visit is pure waste. */
const RATES_TTL_MS = 60 * 60 * 1000;

type RatesResponse = {
  rates?: Record<string, number>;
};

type CacheEntry = { rates: Record<string, number>; fetchedAt: number };

/**
 * Module-level so the four pages that use this hook share one request.
 *
 * `inFlight` is the single-flight guard: two components mounting together must not
 * produce two requests to a third-party host.
 */
let cache: CacheEntry | null = null;
let inFlight: Promise<Record<string, number>> | null = null;

/** Test seam: drops the cache so one test cannot leak into the next. */
export function __resetRatesCache(): void {
  cache = null;
  inFlight = null;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError"
  );
}

async function fetchRatesOnce(): Promise<Record<string, number>> {
  // No timeout at all previously: a hung host left `loadingRates` true forever, and
  // CurrencySelect disables itself while that is true — so the feature died silently.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RATES_TIMEOUT_MS);

  try {
    const response = await fetch(RATES_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to load exchange rates (${response.status})`);
    }
    const data = (await response.json()) as RatesResponse;
    if (!data.rates || typeof data.rates !== "object") {
      throw new Error("Unexpected exchange rates response");
    }
    return { USD: 1, ...data.rates };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRatesWithRetry(): Promise<Record<string, number>> {
  try {
    return await fetchRatesOnce();
  } catch (err) {
    if (isAbortError(err)) {
      // A host that just timed out will very likely time out again; retrying it would
      // only double the wait before the currency control comes back to life, so
      // surface the timeout immediately instead.
      throw err;
    }
    // One retry for anything else (a dropped connection, a bad response, ...). A
    // single transient failure otherwise disabled the currency control for the life
    // of the page.
    return await fetchRatesOnce();
  }
}

function loadRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < RATES_TTL_MS) {
    return Promise.resolve(cache.rates);
  }

  inFlight ??= (async () => {
    try {
      const rates = await fetchRatesWithRetry();
      cache = { rates, fetchedAt: Date.now() };
      return rates;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Consumers that only need to display a converted price should pass the whole
 * `conversion` object (as `CurrencySelect` does) rather than picking `formatConverted`
 * out and threading it through further components — see `SellerOrdersTab` /
 * `OrderCard` and `SellerListingsTab` / `SellerListingCard` for the drilling this
 * hook currently causes (deferred: not a single-file fix).
 */
export function useCurrencyConversion() {
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 });
  const [selectedCurrency, setSelectedCurrency] = useState<string>("USD");
  const [loadingRates, setLoadingRates] = useState(true);
  const [ratesError, setRatesError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    loadRates()
      .then((loaded) => {
        if (!alive) return;
        setRates(loaded);
        setRatesError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setRatesError(
          err instanceof Error ? err.message : "Failed to load exchange rates",
        );
      })
      .finally(() => {
        if (alive) setLoadingRates(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const availableCurrencies = useMemo(() => {
    return DEFAULT_CURRENCIES.filter((currency) => Boolean(rates[currency]));
  }, [rates]);

  function convertFromUsd(amountUsd: number): number | null {
    const rate = rates[selectedCurrency];
    // Previously `?? 1`, which returned the USD amount unchanged — and then
    // formatConverted stamped the selected currency's symbol on it. Unreachable today
    // because availableCurrencies is derived from `rates`, but that is an invariant
    // held somewhere else, and the failure mode is wrong money.
    return rate === undefined ? null : amountUsd * rate;
  }

  function formatConverted(amountUsd: number): string {
    const converted = convertFromUsd(amountUsd);
    if (converted === null) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: selectedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(converted);
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
