/**
 * Downloads Xenova/all-MiniLM-L6-v2 into the Transformers.js cache.
 *
 * Run at Docker build time so a container never fetches ~25 MB of model on its first
 * request — C2C-AI-2 AC7 asserts that a container with no network at all can still embed.
 * Useful locally too, before an offline demo.
 *
 *   TRANSFORMERS_CACHE=/app/.cache/transformers node scripts/prefetch-embedding-model.mjs
 */
import { env, pipeline } from "@huggingface/transformers";

const MODEL = "Xenova/all-MiniLM-L6-v2";

if (process.env.TRANSFORMERS_CACHE) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE;
}

const started = Date.now();
console.log(`prefetching ${MODEL} into ${env.cacheDir}`);

const extract = await pipeline("feature-extraction", MODEL);

// Run one inference: downloading the weights is not proof they load. If the ONNX runtime
// cannot start in this image, it must fail here, during the build, and not at runtime in
// front of a user.
const output = await extract("prefetch smoke test", { pooling: "mean", normalize: true });

if (output.data.length !== 384) {
  throw new Error(`expected 384 dimensions, got ${output.data.length}`);
}

console.log(`prefetched and verified in ${Date.now() - started}ms`);
