/**
 * C2C-AI-5 — prompt templates.
 *
 * SPEC PHASE SKELETON.
 */
const NOT_IMPLEMENTED = "not implemented — C2C-AI-5 is in its spec phase";

/**
 * Bumped whenever the wording changes.
 *
 * A thesis reporting "the model produced this" must be able to say which prompt produced
 * it; a template edited in place silently invalidates every earlier result.
 */
export const DESCRIPTION_PROMPT_VERSION = "v1";

export type DescriptionPromptInput = {
  title: string;
  keywords?: string[];
  categoryName?: string;
  language?: "en" | "sr";
};

export type BuiltPrompt = { system: string; user: string };

/** Builds the system and user messages for a listing description. */
export function buildDescriptionPrompt(_input: DescriptionPromptInput): BuiltPrompt {
  throw new Error(NOT_IMPLEMENTED);
}
