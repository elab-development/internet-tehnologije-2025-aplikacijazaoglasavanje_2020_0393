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

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  warmup.mockClear();
  warmup.mockImplementation(async () => {});
  // A trusted hop, so the AI-2 cases below do not each print the proxy warning the last
  // describe in this file is about. They set their own value.
  process.env.TRUSTED_PROXY_HOPS = "1";
});

afterEach(() => {
  process.env = originalEnv;
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

/**
 * Spec §3.2 — the one line that makes a silent fail-open audible.
 *
 * `TRUSTED_PROXY_HOPS=0` is the default and it disables every IP-keyed rate limit. That is
 * the correct behaviour (a shared fallback bucket would let one abuser lock out the whole
 * deployment), but a deployment that merely forgot the variable gets the reduced
 * protection with no signal whatsoever. Section 12 of the spec leans on this warning
 * existing, and it did not, so it is pinned here rather than left to a reader's goodwill.
 */
describe("the startup warning for an untrusted-proxy deployment", () => {
  /** Everything `register` wrote to `console.warn`, as one string. */
  async function warningsFrom(hops: string | undefined): Promise<string> {
    if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = hops;

    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await register();

    return warned.mock.calls.map((args) => args.join(" ")).join("\n");
  }

  beforeEach(() => {
    process.env.NEXT_RUNTIME = "nodejs";
  });

  it("warns when the variable is unset, naming it, the consequence and the fix", async () => {
    const output = await warningsFrom(undefined);

    expect(output).toContain("TRUSTED_PROXY_HOPS");
    // The consequence, not merely the value: a line reading "hops is 0" and stopping
    // there tells an operator nothing they could act on.
    expect(output).toMatch(/IP-keyed rate limit.*skipped/i);
    expect(output).toMatch(/set it to/i);
  });

  it("warns for an explicit 0, and for a malformed value that falls back to 0", async () => {
    // `trustedProxyHops` fails closed on anything non-numeric, so a typo lands in exactly
    // the state this warning exists for and has to be just as audible.
    expect(await warningsFrom("0")).toContain("TRUSTED_PROXY_HOPS");
    expect(await warningsFrom("one")).toContain("TRUSTED_PROXY_HOPS");
  });

  it("stays quiet once a proxy is trusted", async () => {
    expect(await warningsFrom("1")).toBe("");
  });

  it("says nothing on the edge runtime, which never serves these routes", async () => {
    process.env.NEXT_RUNTIME = "edge";

    expect(await warningsFrom(undefined)).toBe("");
  });
});
