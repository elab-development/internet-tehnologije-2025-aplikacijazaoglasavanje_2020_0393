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
