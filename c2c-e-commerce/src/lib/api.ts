// ─── API helper ───────────────────────────────────────────────────────────────
// Thin fetch wrapper that:
//   • Prepends the API base URL
//   • Sends the httpOnly session cookies with every request
//   • Sets Content-Type: application/json
//   • Recovers from an expired access token by refreshing once, silently
//   • Throws a plain Error with the server's message on non-2xx responses
//
// No token is handled here. Both the access token and the refresh token live in
// httpOnly cookies the browser attaches automatically, so no script -- ours or an
// injected one -- can read them. Do not reintroduce localStorage token storage.

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

const REFRESH_ENDPOINT = "/api/auth/refresh";

/**
 * Endpoints whose own 401 is a real answer rather than an expired session.
 *
 * Refreshing after a rejected login would turn "wrong password" into two requests and
 * the same rejection; refreshing after a failed refresh is an infinite loop.
 */
const NO_REFRESH = [REFRESH_ENDPOINT, "/api/auth/login", "/api/auth/register"];

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * The in-flight refresh, if one is running.
 *
 * Single-flight matters more than it looks: a page that fires five requests on mount
 * would otherwise send five refreshes, and since rotation is single-use (SEC-3) four of
 * them would present an already-rotated token — which the server correctly reads as
 * theft and answers by revoking the family. Concurrency here is not a performance
 * detail; getting it wrong logs the user out.
 */
let inFlightRefresh: Promise<boolean> | null = null;

/** Called when the session could not be recovered, so the app can clear its state. */
let authLostHandler: (() => void) | null = null;

/**
 * Runs at most one refresh at a time; concurrent callers await the same promise.
 *
 * @returns whether the session was recovered.
 */
function refreshSession(): Promise<boolean> {
  inFlightRefresh ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}${REFRESH_ENDPOINT}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      return res.ok;
    } catch {
      // Offline, or the server is unreachable. Indistinguishable from a dead session
      // as far as this request is concerned.
      return false;
    } finally {
      // Cleared in `finally` so the *next* 401 starts a fresh flight rather than
      // awaiting a settled promise forever.
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

async function send(endpoint: string, options: RequestOptions): Promise<Response> {
  const { method = "GET", body, headers = {} } = options;

  const config: RequestInit = {
    method,
    // "same-origin" would cover the default deployment, but "include" also
    // works when NEXT_PUBLIC_API_URL points the client at a separate host.
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  return fetch(`${BASE_URL}${endpoint}`, config);
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  let res = await send(endpoint, options);

  // ── Silent refresh ────────────────────────────────────────────────────────
  // Exactly one attempt. A retry that 401s again is surfaced to the caller: trying
  // once more would hammer the API and cannot succeed, since the second refresh would
  // present a token the first one already rotated.
  if (res.status === 401 && !NO_REFRESH.includes(endpoint)) {
    const recovered = await refreshSession();

    if (recovered) {
      res = await send(endpoint, options);
    } else {
      authLostHandler?.();
    }
  }

  // No-content response
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      (data as { error?: string; message?: string }).error ??
      (data as { error?: string; message?: string }).message ??
      `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  get: <T>(endpoint: string, headers?: Record<string, string>) =>
    request<T>(endpoint, { method: "GET", headers }),

  post: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, { method: "POST", body }),

  put: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, { method: "PUT", body }),

  patch: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, { method: "PATCH", body }),

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: "DELETE" }),

  /**
   * Registers the callback fired when a session could not be recovered.
   *
   * `AuthContext` uses it to clear state and send the user to /login. Pass `null` to
   * unregister.
   */
  onAuthLost: (handler: (() => void) | null) => {
    authLostHandler = handler;
  },
};

/** Test seam: drops any in-flight refresh so one test cannot leak into the next. */
export function __resetRefreshState(): void {
  inFlightRefresh = null;
  authLostHandler = null;
}
