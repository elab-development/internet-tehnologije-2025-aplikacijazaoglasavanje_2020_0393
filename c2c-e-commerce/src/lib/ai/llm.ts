/**
 * C2C-AI-1 — pluggable LLM provider.
 *
 * SPEC PHASE SKELETON. This file currently declares the seam and nothing else: every
 * behaviour throws `not implemented`, so the tests in `llm.test.ts` fail on the missing
 * behaviour rather than on an unresolved import. The implementation commit fills the
 * bodies in; the signatures below are the contract AI-5 and QA-6 build against.
 */

/** Why an LLM call failed. AI-5 maps every one of these to a 502. */
export type LlmErrorKind = "http" | "timeout" | "network" | "malformed";

/**
 * A failure talking to a language model.
 *
 * Never carries the API key: `message` is built from the upstream status and a fixed
 * string, never from the request headers.
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

const NOT_IMPLEMENTED = "not implemented — C2C-AI-1 is in its spec phase";

/** Deterministic, offline provider used by tests and by `LLM_PROVIDER=mock`. */
export class MockProvider implements LlmProvider {
  get model(): string {
    throw new Error(NOT_IMPLEMENTED);
  }

  generate(_prompt: string, _opts?: LlmGenerateOptions): Promise<string> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/** Groq's OpenAI-compatible chat-completions API. */
export class GroqProvider implements LlmProvider {
  get model(): string {
    throw new Error(NOT_IMPLEMENTED);
  }

  generate(_prompt: string, _opts?: LlmGenerateOptions): Promise<string> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/** Selects a provider from `LLM_PROVIDER`, read fresh on every call. */
export function getLlmProvider(): LlmProvider {
  throw new Error(NOT_IMPLEMENTED);
}
