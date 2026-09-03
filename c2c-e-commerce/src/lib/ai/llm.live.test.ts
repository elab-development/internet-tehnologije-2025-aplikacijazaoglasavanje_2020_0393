/**
 * C2C-AI-1 spec — AC2 against the real Groq API.
 *
 * Opt-in only. The story's test notes forbid live Groq calls in CI, but AC2 is written
 * about the real API, so it gets a real test that a human runs on demand:
 *
 *   RUN_LIVE_LLM=1 npm run test:unit -- src/lib/ai/llm.live.test.ts
 *
 * The key is read from `.env.local`, never from a committed file.
 */
import { config as loadEnv } from "dotenv";
import { describe, expect, it } from "vitest";

import { GroqProvider, getLlmProvider } from "./llm";

const live = process.env.RUN_LIVE_LLM === "1";

if (live) {
  loadEnv({ path: ".env.local", quiet: true });
}

describe.skipIf(!live)("C2C-AI-1 — GroqProvider against the live API", () => {
  it("AC2: returns a completion string from the Groq API", async () => {
    process.env.LLM_PROVIDER = "groq";

    const provider = getLlmProvider();
    expect(provider).toBeInstanceOf(GroqProvider);

    const text = await provider.generate(
      "In one sentence, describe a second-hand mountain bike for a marketplace listing.",
      { maxTokens: 120, temperature: 0.4 },
    );

    expect(typeof text).toBe("string");
    expect(text.trim().length).toBeGreaterThan(20);
  }, 30_000);
});
