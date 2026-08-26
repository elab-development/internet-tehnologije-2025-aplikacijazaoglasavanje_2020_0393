/**
 * C2C-AI-2 spec — AC7: the model is baked into the image at build time.
 *
 * Opt-in: this builds the Docker image and runs a container, which takes minutes.
 *
 *   RUN_DOCKER_TESTS=1 npm run test:unit -- src/lib/ai/embeddings.docker.test.ts
 *
 * `--network none` is the whole point. A container that can reach the internet proves
 * nothing about whether the model was baked in; one that cannot, and still embeds, proves
 * it exactly.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_DOCKER_TESTS === "1";
const APP_ROOT = path.resolve(__dirname, "../../..");
const IMAGE = "c2c-embeddings-ac7";

function docker(args: string[], timeoutMs: number): string {
  return execFileSync("docker", args, {
    cwd: APP_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Runs inside the container. Deliberately talks to @xenova/transformers directly rather
 * than to our own module: the standalone bundle is not importable as a library, and what
 * AC7 is actually about is whether the model files are on disk.
 */
const PROBE = `
const { pipeline, env } = require("@xenova/transformers");
env.allowRemoteModels = false;
(async () => {
  const extract = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const out = await extract("offline smoke test", { pooling: "mean", normalize: true });
  const vector = Array.from(out.data);
  if (vector.length !== 384) throw new Error("expected 384 dims, got " + vector.length);
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (Math.abs(norm - 1) > 0.001) throw new Error("not normalised: " + norm);
  console.log("OK " + vector.length);
})().catch((e) => { console.error(e.message); process.exit(1); });
`;

describe.skipIf(!enabled)("C2C-AI-2 — AC7: baked-in model cache", () => {
  it("AC7: builds an image with the model already present", () => {
    const output = docker(["build", "-t", IMAGE, "."], 20 * 60_000);
    expect(output).toBeTypeOf("string");
  }, 20 * 60_000);

  it("AC7: a container with no network still embeds from the baked-in cache", () => {
    const output = docker(
      ["run", "--rm", "--network", "none", IMAGE, "node", "-e", PROBE],
      5 * 60_000,
    );
    expect(output).toContain("OK 384");
  }, 5 * 60_000);
});
