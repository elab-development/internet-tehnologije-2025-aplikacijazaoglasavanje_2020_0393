import { trustedProxyHops } from "@/lib/client-ip";

/**
 * C2C-AI-2 — server start.
 *
 * Next.js calls `register()` once per server process, before the first request. That is
 * the only place the ~1.9 s Transformers.js model load can be paid without a user waiting
 * for it: the alternative is that it lands on whichever seller happens to publish the
 * first listing after a deploy.
 */
export async function register(): Promise<void> {
  // The edge runtime has no filesystem and cannot load onnxruntime; `register` runs on
  // both, so the guard is not optional.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  warnIfNoProxyIsTrusted();

  // Imported here rather than at module scope so the edge bundle never pulls the model
  // code in at all.
  const { warmupEmbeddings } = await import("@/lib/ai/embeddings");

  try {
    await warmupEmbeddings();
  } catch (error) {
    // Never fail boot on this. AI-4 already tolerates a failed embed at write time —
    // refusing to start would take the whole marketplace down for a feature that
    // degrades to keyword search on its own.
    console.error("[instrumentation] embedding warmup failed", error);
  }
}

/**
 * The compensating control for a deliberate fail-open (spec §3.2).
 *
 * At zero trusted hops `clientIdentity` reports every caller as unknowable and each
 * IP-keyed limit is skipped rather than applied to a shared bucket — the right call, but
 * a silent one. A deployment that simply forgot the variable is materially less protected
 * than its operator believes, and nothing else in the system would ever say so. One line
 * at boot is what turns "misconfigured" into something a log search can find.
 *
 * Deliberately not fatal: the default is safe for local development, and refusing to
 * start would make a warning into an outage.
 */
function warnIfNoProxyIsTrusted(): void {
  if (trustedProxyHops(process.env.TRUSTED_PROXY_HOPS) >= 1) return;

  console.warn(
    "[instrumentation] TRUSTED_PROXY_HOPS is 0: no proxy is trusted, so every IP-keyed " +
      "rate limit is skipped and only the account-keyed limits apply. Set it to the " +
      "number of proxies in front of this process (1 behind Railway) in any deployment " +
      "that is not local development.",
  );
}
