/**
 * C2C-AI-1 — pluggable LLM provider.
 *
 * One interface, two implementations: `GroqProvider` for real use and `MockProvider` for
 * tests and offline demos, selected by `LLM_PROVIDER`. This is the seam that keeps every
 * later AI story testable without a paid, rate-limited, non-deterministic dependency.
 *
 * Environment:
 *   LLM_PROVIDER    "groq" | "mock" — defaults to mock under NODE_ENV=test, groq otherwise
 *   GROQ_API_KEY    required by GroqProvider; absence throws at construction
 *   GROQ_MODEL      defaults to qwen/qwen3.8-27b
 *   LLM_TIMEOUT_MS  defaults to 15000
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
const DEFAULT_TIMEOUT_MS = 15_000;
const MOCK_MODEL = "mock-llm-v1";

/** Why an LLM call failed. AI-5 maps every one of these to a 502. */
export type LlmErrorKind = "http" | "timeout" | "network" | "malformed";

/**
 * A failure talking to a language model.
 *
 * Never carries the API key: `message` is built from the upstream status and a fixed
 * string, never from the request headers or the response body.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;

  constructor(
    message: string,
    options: { kind: LlmErrorKind; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "LlmError";
    this.kind = options.kind;
    this.status = options.status;
  }
}

export interface LlmGenerateOptions {
  /** System message placed ahead of the prompt. */
  system?: string;
  temperature?: number;
  /** Upper bound on generated tokens — AI-5 uses it to cap quota burn. */
  maxTokens?: number;
  /** Caller-supplied cancellation, combined with the provider's own timeout. */
  signal?: AbortSignal;
}

export interface LlmProvider {
  /** Model identifier, echoed to the client in AI-5's response. */
  readonly model: string;
  generate(prompt: string, opts?: LlmGenerateOptions): Promise<string>;
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

/**
 * FNV-1a, 32-bit. Deterministic across processes and platforms, which an ad-hoc
 * character sum is not — QA-6's ranking tests depend on that stability.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic, offline provider used by tests and by `LLM_PROVIDER=mock`.
 *
 * The output has to be stable for a given prompt and different across prompts — AC1
 * asserts both — so it is built from a hash of the prompt rather than from a fixed string.
 */
export class MockProvider implements LlmProvider {
  readonly model = MOCK_MODEL;

  // No `opts` parameter: the mock honours none of them, and a narrower signature still
  // satisfies `LlmProvider`.
  generate(prompt: string): Promise<string> {
    const fingerprint = fnv1a(prompt).toString(16).padStart(8, "0");
    const subject = prompt.trim().slice(0, 80) || "an unnamed item";

    return Promise.resolve(
      `[${MOCK_MODEL}:${fingerprint}] A generated description for "${subject}". ` +
        "This text is produced offline by the deterministic mock provider and is not " +
        "the output of a language model.",
    );
  }
}

// ─── Groq ─────────────────────────────────────────────────────────────────────

type ChatCompletion = {
  choices?: { message?: { content?: string } }[];
};

function readTimeoutMs(): number {
  const raw = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Fail loudly and at the boundary, the way `getJwtSecret()` does in `src/lib/auth.ts`.
 * A blank value is a configuration mistake — `GROQ_API_KEY=` in a .env file yields "" —
 * not a credential, so it is treated as absent rather than sent upstream to earn a 401.
 */
function requireApiKey(): string {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    throw new Error("GROQ_API_KEY environment variable is not set");
  }
  return key;
}

/** Groq's OpenAI-compatible chat-completions API. */
export class GroqProvider implements LlmProvider {
  readonly model: string;
  /** Read once at construction so a later rotation cannot half-apply mid-request. */
  readonly #apiKey: string;

  constructor() {
    this.#apiKey = requireApiKey();
    this.model = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
  }

  async generate(prompt: string, opts: LlmGenerateOptions = {}): Promise<string> {
    const timeoutMs = readTimeoutMs();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    // AbortSignal.any rejects undefined members, and opts.signal is usually absent.
    const signal = AbortSignal.any(
      [timeoutSignal, opts.signal].filter((s): s is AbortSignal => s !== undefined),
    );

    const messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: prompt },
    ];

    let response: Response;
    try {
      response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
        }),
        signal,
      });
    } catch (cause) {
      if (signal.aborted) {
        throw new LlmError(
          timeoutSignal.aborted
            ? `Groq request timed out after ${timeoutMs}ms`
            : "Groq request was aborted by the caller",
          { kind: "timeout", cause },
        );
      }
      // DNS failure, TLS failure, connection reset — anything fetch itself threw.
      throw new LlmError("Groq request could not be sent", { kind: "network", cause });
    }

    if (!response.ok) {
      // The upstream body is deliberately not interpolated: nothing from the request or
      // the response should be able to reach a log line or a client-facing message.
      throw new LlmError(`Groq request failed with status ${response.status}`, {
        kind: "http",
        status: response.status,
      });
    }

    let body: ChatCompletion;
    try {
      body = (await response.json()) as ChatCompletion;
    } catch (cause) {
      throw new LlmError("Groq returned a body that is not JSON", {
        kind: "malformed",
        status: response.status,
        cause,
      });
    }

    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new LlmError("Groq returned no completion", {
        kind: "malformed",
        status: response.status,
      });
    }

    return content;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Selects a provider from `LLM_PROVIDER`, read fresh on every call.
 *
 * Nothing is memoised: construction is two env reads, and a cached instance would pin the
 * first `LLM_PROVIDER` value the process ever saw. AI-2's embedding provider does cache,
 * because there a ~25 MB model load is at stake.
 */
export function getLlmProvider(): LlmProvider {
  const configured = process.env.LLM_PROVIDER?.trim();
  const choice = configured || (process.env.NODE_ENV === "test" ? "mock" : "groq");

  switch (choice) {
    case "mock":
      return new MockProvider();
    case "groq":
      return new GroqProvider();
    default:
      throw new Error(
        `LLM_PROVIDER must be "groq" or "mock", received "${configured}"`,
      );
  }
}
