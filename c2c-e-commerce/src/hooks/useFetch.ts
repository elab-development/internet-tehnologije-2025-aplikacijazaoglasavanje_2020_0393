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

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `GET`s an endpoint and tracks the request's data/loading/error state.
 *
 * ```tsx
 * const { data: orders, loading, error } = useFetch<Order[]>("/api/orders");
 * ```
 *
 * Pass `null` as the endpoint when the request is not ready yet — for example
 * while waiting for the authenticated user — and `loading` stays `true` until a
 * real endpoint arrives:
 *
 * ```tsx
 * const { data } = useFetch<ListingsResponse>(
 *   user ? `/api/listings?sellerId=${user.id}` : null
 * );
 * ```
 *
 * `deps` is appended to the effect's dependency array for values the endpoint
 * string does not already capture.
 *
 * A response that arrives after the endpoint changed (or after unmount) is
 * discarded, and failures both set `error` and raise a toast.
 */
export function useFetch<T>(
  endpoint: string | null,
  deps: unknown[] = []
): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  const refetch = useCallback(() => setReloadCount((count) => count + 1), []);

  useEffect(() => {
    if (endpoint === null) return;

    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await api.get<T>(endpoint as string);
        if (!alive) return;
        setData(result);
      } catch (err: unknown) {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : "Failed to load";
        setError(msg);
        toast.error(msg);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
    // `deps` is caller-supplied, so its length is not statically known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, reloadCount, ...deps]);

  return { data, setData, loading, error, refetch };
}
