/**
 * C2C-AI-5 — prompt templates.
 *
 * Kept apart from the route so the wording is reviewable on its own, and so a change to it
 * shows up in a diff as a change to *the prompt* rather than buried in a handler.
 */

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

const LANGUAGE_NAME = { en: "English", sr: "Serbian" } as const;

/**
 * Builds the system and user messages for a listing description.
 *
 * The constraints are not stylistic preferences. Each one blocks a way a generated
 * description can mislead a buyer: invented specifications and prices are claims the seller
 * never made, and contact details route a transaction off the platform.
 */
export function buildDescriptionPrompt(input: DescriptionPromptInput): BuiltPrompt {
  const language = LANGUAGE_NAME[input.language ?? "en"];

  const system = [
    `You write product descriptions for a second-hand marketplace. Reply in ${language}.`,
    "",
    "Rules:",
    "- Between 60 and 120 words.",
    "- Plain text only. No markdown, no headings, no bullet points.",
    "- Describe only what the seller stated. Never invent specifications, measurements,",
    "  condition details, brands or model numbers.",
    "- Never state or estimate a price.",
    "- Never include contact details, links, or an invitation to message off-platform.",
    "- Write the description and nothing else: no preamble, no commentary, no quotes",
    "  around your answer.",
  ].join("\n");

  // The title is attacker-controlled text. Delimiting and labelling it does not make prompt
  // injection impossible, but pasting it unlabelled into an instruction is the version that
  // is trivially exploitable.
  const parts = [`Product title: "${input.title}"`];

  if (input.categoryName) parts.push(`Category: "${input.categoryName}"`);
  if (input.keywords?.length) {
    parts.push(`Keywords: ${input.keywords.map((k) => `"${k}"`).join(", ")}`);
  }

  parts.push("", "Write the description for this listing.");

  return { system, user: parts.join("\n") };
}
