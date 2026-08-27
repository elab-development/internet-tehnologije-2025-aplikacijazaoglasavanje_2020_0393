/**
 * C2C-AI-2 spec — AC7's companion: the model load happens at server start.
 *
 * `warmupEmbeddings()` existed and was exported from the first commit of AI-2, and nothing
 * ever called it. An unwired warmup is not a slower warmup — it is no warmup, and the
 * ~1.9 s model load lands on whichever seller happens to publish first after a deploy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const warmup = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/ai/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/embeddings")>()),
  warmupEmbeddings: warmup,
}));

const originalRuntime = process.env.NEXT_RUNTIME;

beforeEach(() => {
  warmup.mockClear();
  warmup.mockImplementation(async () => {});
});

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
  vi.restoreAllMocks();
});

describe("C2C-AI-2 — server start", () => {
  it("warms the embedding model on the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";

    const { register } = await import("./instrumentation");
    await register();

    expect(warmup).toHaveBeenCalledTimes(1);
  });

  it("does not warm on the edge runtime, which cannot load the model", async () => {
    process.env.NEXT_RUNTIME = "edge";

    const { register } = await import("./instrumentation");
    await register();

    expect(warmup).not.toHaveBeenCalled();
  });

  it("does not fail boot when the model cannot be loaded", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    warmup.mockRejectedValue(new Error("no model cache and no network"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const { register } = await import("./instrumentation");

    // AI-4 already tolerates a failed embed at write time; refusing to start over one
    // would take the whole marketplace down for a feature that degrades gracefully.
    await expect(register()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
  });
});
