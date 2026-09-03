/**
 * C2C-AI-1 spec — pluggable LLM provider with a deterministic mock.
 *
 * Unit tests only. `global.fetch` is stubbed in every Groq test: per the story's test
 * notes there is never a live Groq call in CI. The opt-in live smoke test lives in
 * `llm.live.test.ts` and is skipped unless RUN_LIVE_LLM=1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GroqProvider,
  LlmError,
  type LlmProvider,
  MockProvider,
  getLlmProvider,
} from "./llm";

/** Distinctive on purpose: AC4 asserts this exact string never leaks. */
const FAKE_KEY = "gsk_spec_sentinel_NEVER_LEAK_0123456789";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function chatCompletion(content: string, model = "qwen/qwen3.8-27b") {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-spec",
      object: "chat.completion",
      model,
      choices: [
        { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl as (...args: unknown[]) => Promise<Response>);
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The body actually sent to Groq, parsed. */
function sentBody(spy: ReturnType<typeof stubFetch>) {
  const init = spy.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string) as {
    model: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    max_tokens?: number;
  };
}

function sentHeaders(spy: ReturnType<typeof stubFetch>) {
  const init = spy.mock.calls[0][1] as RequestInit;
  return new Headers(init.headers);
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", FAKE_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("C2C-AI-1 — getLlmProvider factory", () => {
  it("AC1: LLM_PROVIDER=mock yields the mock provider", () => {
    vi.stubEnv("LLM_PROVIDER", "mock");
    expect(getLlmProvider()).toBeInstanceOf(MockProvider);
  });

  it("AC6: an unset LLM_PROVIDER defaults to mock under NODE_ENV=test", () => {
    vi.stubEnv("LLM_PROVIDER", undefined);
    vi.stubEnv("NODE_ENV", "test");
    expect(getLlmProvider()).toBeInstanceOf(MockProvider);
  });

  it("AC6: an unset LLM_PROVIDER defaults to groq outside NODE_ENV=test", () => {
    vi.stubEnv("LLM_PROVIDER", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(getLlmProvider()).toBeInstanceOf(GroqProvider);
  });

  it("AC3: LLM_PROVIDER=groq without GROQ_API_KEY throws, naming the variable", () => {
    vi.stubEnv("LLM_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", undefined);
    expect(() => getLlmProvider()).toThrowError(/GROQ_API_KEY/);
  });

  it("AC3: a missing GROQ_API_KEY never silently falls back to the mock", () => {
    vi.stubEnv("LLM_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", undefined);

    let provider: LlmProvider | undefined;
    let thrown: unknown;
    try {
      provider = getLlmProvider();
    } catch (error) {
      thrown = error;
    }

    expect(provider).toBeUndefined();
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/GROQ_API_KEY/);
  });

  it("AC3: an empty or whitespace-only GROQ_API_KEY counts as missing", () => {
    vi.stubEnv("LLM_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "   ");
    expect(() => getLlmProvider()).toThrowError(/GROQ_API_KEY/);
  });

  it("AC6: an unrecognised LLM_PROVIDER throws, naming the allowed values", () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    expect(() => getLlmProvider()).toThrowError(
      /groq[\s\S]*mock|mock[\s\S]*groq/,
    );
  });
});

describe("C2C-AI-1 — MockProvider", () => {
  it("AC1: resolves without touching the network", async () => {
    const spy = stubFetch(async () => chatCompletion("unreachable"));

    await expect(new MockProvider().generate("x")).resolves.toEqual(expect.any(String));
    expect(spy).not.toHaveBeenCalled();
  });

  it("AC1: returns the same string for the same prompt, every time", async () => {
    const first = await new MockProvider().generate("write me a bicycle listing");
    const second = await new MockProvider().generate("write me a bicycle listing");
    expect(first).toBe(second);
  });

  it("AC1: derives its output from the prompt, so different prompts differ", async () => {
    const provider = new MockProvider();
    const bike = await provider.generate("write me a bicycle listing");
    const chair = await provider.generate("write me an office chair listing");
    expect(bike).not.toBe(chair);
  });

  it("AC1: returns a non-empty string", async () => {
    const text = await new MockProvider().generate("anything");
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("AC1: reports a model identifier, which AI-5 echoes back to the client", () => {
    expect(new MockProvider().model).toEqual(expect.any(String));
    expect(new MockProvider().model.length).toBeGreaterThan(0);
  });
});

describe("C2C-AI-1 — GroqProvider", () => {
  it("AC2: returns the assistant message from a successful completion", async () => {
    stubFetch(async () => chatCompletion("A well-loved mountain bike."));

    const text = await new GroqProvider().generate("describe a mountain bike");
    expect(text).toBe("A well-loved mountain bike.");
  });

  it("AC2: POSTs to the OpenAI-compatible endpoint with bearer auth and JSON", async () => {
    const spy = stubFetch(async () => chatCompletion("ok"));

    await new GroqProvider().generate("hello");

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(GROQ_URL);
    expect(init.method).toBe("POST");

    const headers = sentHeaders(spy);
    expect(headers.get("authorization")).toBe(`Bearer ${FAKE_KEY}`);
    expect(headers.get("content-type")).toMatch(/application\/json/);
  });

  it("AC2: sends the prompt as a user message", async () => {
    const spy = stubFetch(async () => chatCompletion("ok"));

    await new GroqProvider().generate("describe a mountain bike");

    const body = sentBody(spy);
    expect(body.messages.at(-1)).toEqual({
      role: "user",
      content: "describe a mountain bike",
    });
  });

  it("AC2: sends a system message ahead of the prompt when one is given", async () => {
    const spy = stubFetch(async () => chatCompletion("ok"));

    await new GroqProvider().generate("hello", { system: "You are terse." });

    const body = sentBody(spy);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are terse." });
    expect(body.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("AC2: defaults the model to qwen/qwen3.8-27b", async () => {
    vi.stubEnv("GROQ_MODEL", undefined);
    const spy = stubFetch(async () => chatCompletion("ok"));

    const provider = new GroqProvider();
    await provider.generate("hello");

    expect(sentBody(spy).model).toBe("qwen/qwen3.8-27b");
    expect(provider.model).toBe("qwen/qwen3.8-27b");
  });

  it("AC2: honours GROQ_MODEL when it is set", async () => {
    vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-120b");
    const spy = stubFetch(async () => chatCompletion("ok", "openai/gpt-oss-120b"));

    const provider = new GroqProvider();
    await provider.generate("hello");

    expect(sentBody(spy).model).toBe("openai/gpt-oss-120b");
    expect(provider.model).toBe("openai/gpt-oss-120b");
  });

  it("AC2: forwards temperature and maxTokens so AI-5 can cap a runaway generation", async () => {
    const spy = stubFetch(async () => chatCompletion("ok"));

    await new GroqProvider().generate("hello", { temperature: 0.2, maxTokens: 256 });

    const body = sentBody(spy);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(256);
  });

  it("AC4: a non-2xx response rejects with an LlmError carrying the upstream status", async () => {
    stubFetch(async () => new Response("rate limited", { status: 429 }));

    const error = await new GroqProvider()
      .generate("hello")
      .catch((e: unknown) => e as LlmError);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe("http");
    expect((error as LlmError).status).toBe(429);
  });

  it("AC4: a 5xx response is distinguishable from a 4xx by its status", async () => {
    stubFetch(async () => new Response("boom", { status: 503 }));

    const error = await new GroqProvider()
      .generate("hello")
      .catch((e: unknown) => e as LlmError);

    expect((error as LlmError).status).toBe(503);
  });

  it("AC4: the API key never appears in the error message, stack or serialisation", async () => {
    stubFetch(async () => new Response("upstream said no", { status: 401 }));

    const error = await new GroqProvider()
      .generate("hello")
      .catch((e: unknown) => e as LlmError);

    const surfaces = [
      (error as LlmError).message,
      (error as LlmError).stack ?? "",
      String(error),
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain(FAKE_KEY);
    }
  });

  it("AC4: the API key never reaches a console log line", async () => {
    const written: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        written.push(args.map(String).join(" "));
      });
    }
    stubFetch(async () => new Response("upstream said no", { status: 401 }));

    await new GroqProvider().generate("hello").catch(() => undefined);

    expect(written.join("\n")).not.toContain(FAKE_KEY);
  });

  it("AC5: a request that outlives LLM_TIMEOUT_MS is aborted and rejects as a timeout", async () => {
    vi.stubEnv("LLM_TIMEOUT_MS", "25");
    const spy = stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

    const error = await new GroqProvider()
      .generate("hello")
      .catch((e: unknown) => e as LlmError);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe("timeout");
    expect((spy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("AC5: a caller-supplied AbortSignal also aborts the request", async () => {
    const controller = new AbortController();
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
          queueMicrotask(() => controller.abort());
        }),
    );

    await expect(
      new GroqProvider().generate("hello", { signal: controller.signal }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("AC4: a response with no choices rejects rather than resolving undefined", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ id: "x", choices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const error = await new GroqProvider()
      .generate("hello")
      .catch((e: unknown) => e as LlmError);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe("malformed");
  });

  it("AC4: a non-JSON body rejects as malformed rather than throwing a SyntaxError", async () => {
    stubFetch(async () => new Response("<html>gateway</html>", { status: 200 }));

    const error = await new GroqProvider()
      .generate("hello")
      .catch((e: unknown) => e as LlmError);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe("malformed");
  });

  it("AC4: a transport failure rejects as a network LlmError, not a raw TypeError", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const error = await new GroqProvider()
      .generate("hello")
      .catch((e: unknown) => e as LlmError);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe("network");
  });

  it("AC3: constructing the provider directly without a key throws too", () => {
    vi.stubEnv("GROQ_API_KEY", undefined);
    expect(() => new GroqProvider()).toThrowError(/GROQ_API_KEY/);
  });
});
