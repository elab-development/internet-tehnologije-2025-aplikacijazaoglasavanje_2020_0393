import type { NextRequest } from "next/server";

// ─── Who is calling ───────────────────────────────────────────────────────────
//
// `X-Forwarded-For` is a list that grows by one entry per proxy, and each proxy appends
// *the address it was talking to*. So the entry a proxy writes is trustworthy; every
// entry to the left of it was written by something further out, and the left-most entry
// was written by the client. Reading the left-most entry — which is what this app did
// until now — asks the attacker who the attacker is.
//
// With `hops` trusted proxies between the client and this process, the client's address
// is at `entries[entries.length - hops]`. Not `length - 1 - hops`: a single proxy sets
// the header to just `"client"`, and that index is -1.
//
// This is a security boundary, so the arithmetic lives in a pure function that can be
// exhaustively tested without constructing a request — the same reason
// `listing-visibility.ts` is shaped this way.

export type ClientIdentity =
  | { kind: "ip"; value: string }
  /** The caller's address is not knowable. Callers must not invent a key from this. */
  | { kind: "untrusted" };

/**
 * How many proxies sit between the client and this process.
 *
 * Defaults to 0 — no proxy trusted — and falls back to 0 for every malformed value.
 * Failing closed matters more than being helpful here: a typo that silently enabled
 * trust would restore the exact bypass this module exists to close.
 */
export function trustedProxyHops(raw: string | undefined): number {
  if (raw === undefined) return 0;

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 0;

  const hops = Number(trimmed);
  return Number.isSafeInteger(hops) ? hops : 0;
}

/**
 * Resolve the caller's address from proxy headers, or report that it is unknowable.
 *
 * @param forwardedFor the raw `X-Forwarded-For` header, or null
 * @param realIp       the raw `X-Real-IP` header, or null
 * @param hops         trusted proxies in front of this process
 */
export function clientIdentityFrom(
  forwardedFor: string | null,
  realIp: string | null,
  hops: number,
): ClientIdentity {
  // No trusted proxy means no header is evidence of anything.
  if (hops < 1) return { kind: "untrusted" };

  const entries = (forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length > 0) {
    const index = entries.length - hops;
    // A negative index means the header carries fewer entries than there are trusted
    // proxies — the header was stripped, or the hop count is wrong. Either way there is
    // no client address in it, and guessing would hand the attacker the left-most entry
    // all over again.
    return index >= 0
      ? { kind: "ip", value: entries[index] }
      : { kind: "untrusted" };
  }

  // Only reached when the trusted proxy sets `X-Real-IP` instead. It is trusted on the
  // same basis and for the same reason: a proxy we have been told to believe wrote it.
  const real = realIp?.trim();
  return real ? { kind: "ip", value: real } : { kind: "untrusted" };
}

/** `clientIdentityFrom`, reading the headers and the environment for you. */
export function clientIdentity(request: NextRequest): ClientIdentity {
  return clientIdentityFrom(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
    trustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
  );
}
