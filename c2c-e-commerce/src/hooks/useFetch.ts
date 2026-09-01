"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UseFetchResult<T> = {
  /** The last successful response, or `null` before the first one arrives. */
  data: T | null;
  /** Lets a caller apply an optimistic update without a round trip. */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
  loading: boolean;
  error: string | null;
  /** Re-runs the request against the current endpoint. */
  refetch: () => void;
};

export type UseFetchOptions = {
  /**
   * How a failure is reported. `"toast"` is the default because eleven consumers
   * rely on it; `"silent"` is for sections that render `null` on error and would
   * otherwise raise a toast about something the user cannot see.
   */
  onError?: "toast" | "silent";
};

/**
 * One state object rather than three `useState` calls.
 *
 * `data` and `loading` used to move independently, and `setLoading(true)` ran in a
 * passive effect — after paint. That produced one rendered frame carrying the previous
 * endpoint's data with `loading: false`, at the new URL.
 */
type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

const INITIAL: FetchState<never> = { data: null, loading: true, error: null };

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `GET`s an endpoint and tracks the request's data/loading/error state.
 *
 * ```tsx
 * const { data: orders, loading, error } = useFetch<Order[]>("/api/orders");
 * ```
 *
 * Pass `null` as the endpoint when the request is not ready yet — for example while
 * waiting for the authenticated user — and `loading` stays `true` until a real
 * endpoint arrives:
 *
 * ```tsx
 * const { data } = useFetch<ListingsResponse>(
 *   user ? `/api/listings?sellerId=${user.id}` : null
 * );
 * ```
 *
 * A response that arrives after the endpoint changed (or after unmount) is discarded.
 * Failures set `error` and, unless `onError: "silent"`, raise a toast.
 */
export function useFetch<T>(
  endpoint: string | null,
  options: UseFetchOptions = {},
): UseFetchResult<T> {
  const { onError = "toast" } = options;

  const [state, setState] = useState<FetchState<T>>(INITIAL);
  const [reloadCount, setReloadCount] = useState(0);
  const [lastEndpoint, setLastEndpoint] = useState(endpoint);

  // Reset during render, not in an effect. An effect runs after paint, which is what
  // produced the stale frame; adjusting state while rendering means the browser never
  // sees the previous endpoint's data under the new one.
  if (endpoint !== lastEndpoint) {
    setLastEndpoint(endpoint);
    setState(INITIAL);
  }

  const refetch = useCallback(() => setReloadCount((count) => count + 1), []);

  const setData = useCallback<React.Dispatch<React.SetStateAction<T | null>>>(
    (update) => {
      setState((prev) => ({
        ...prev,
        data:
          typeof update === "function"
            ? (update as (previous: T | null) => T | null)(prev.data)
            : update,
      }));
    },
    [],
  );

  useEffect(() => {
    if (endpoint === null) return;

    let alive = true;

    async function load() {
      try {
        const result = await api.get<T>(endpoint as string);
        if (!alive) return;
        setState({ data: result, loading: false, error: null });
      } catch (err: unknown) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Failed to load";
        setState({ data: null, loading: false, error: message });
        if (onError === "toast") toast.error(message);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [endpoint, reloadCount, onError]);

  return { ...state, setData, refetch };
}
