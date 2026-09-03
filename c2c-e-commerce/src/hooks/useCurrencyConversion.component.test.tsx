/**
 * The rates come from a third-party host with no timeout, no retry and no cache, on
 * four separate pages. A hung host left the currency control disabled forever, because
 * CurrencySelect disables itself while `loadingRates` is true.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { useCurrencyConversion, __resetRatesCache } from "./useCurrencyConversion";

beforeEach(() => {
  __resetRatesCache();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCurrencyConversion", () => {
  it("gives up on a hung host instead of loading forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      ),
    );

    const { result } = renderHook(() => useCurrencyConversion());
    expect(result.current.loadingRates).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });

    // Without a timeout the select stays disabled for the life of the page.
    await waitFor(() => expect(result.current.loadingRates).toBe(false));
    expect(result.current.ratesError).toMatch(/exchange rates/i);
  });

  it("fetches once for two consumers rather than once each", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ rates: { EUR: 0.9 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = renderHook(() => useCurrencyConversion());
    const second = renderHook(() => useCurrencyConversion());

    await waitFor(() => expect(first.result.current.loadingRates).toBe(false));
    await waitFor(() => expect(second.result.current.loadingRates).toBe(false));

    // Four pages each fetching the same rates uncached is the waste this closes.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once before reporting failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rates: { EUR: 0.9 } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCurrencyConversion());

    await waitFor(() => expect(result.current.loadingRates).toBe(false));
    expect(result.current.ratesError).toBeNull();
    expect(result.current.availableCurrencies).toContain("EUR");
  });

  it("never formats an unconverted amount under another currency's symbol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ rates: {} }), { status: 200 })),
    );

    const { result } = renderHook(() => useCurrencyConversion());
    await waitFor(() => expect(result.current.loadingRates).toBe(false));

    // Latent today because availableCurrencies is derived from `rates`. Pinned so a
    // refactor of that invariant cannot silently start mislabelling money.
    act(() => { result.current.setSelectedCurrency("EUR"); });

    // A missing rate must show a dash, not an unconverted number stamped with a
    // currency symbol that doesn't apply to it (see the brief's L11/H14 resolution:
    // showing "—" is honest, showing an unconverted number under EUR's symbol is not).
    expect(result.current.formatConverted(100)).not.toMatch(/€\s?100\.00/);
    expect(result.current.formatConverted(100)).toBe("—");
  });
});
