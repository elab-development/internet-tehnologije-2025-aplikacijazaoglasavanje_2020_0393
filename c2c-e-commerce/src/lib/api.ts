// ─── API helper ───────────────────────────────────────────────────────────────
// Thin fetch wrapper that:
//   • Prepends the API base URL
//   • Sends the httpOnly auth cookie with every request
//   • Sets Content-Type: application/json
//   • Throws a plain Error with the server's message on non-2xx responses
//
// The JWT is never handled here. It lives in an httpOnly cookie the browser
// attaches automatically, so no script -- ours or an injected one -- can read
// it. Do not reintroduce localStorage token storage.

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

async function request<T>(
  endpoint: string,
  { method = "GET", body, headers = {} }: RequestOptions = {}
): Promise<T> {
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

  const res = await fetch(`${BASE_URL}${endpoint}`, config);

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
};
