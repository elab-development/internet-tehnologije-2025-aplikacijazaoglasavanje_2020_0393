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
export const DESCRIPTION_PROMPT_VERSION = "v3";

/** The word budget the prompt states and `trimToWordBudget` enforces. */
export const MIN_DESCRIPTION_WORDS = 60;
export const MAX_DESCRIPTION_WORDS = 120;

export type DescriptionPromptInput = {
  title: string;
  keywords?: string[];
  categoryName?: string;
  language?: "en" | "sr";
};

export type BuiltPrompt = { system: string; user: string };

const LANGUAGE_NAME = { en: "English", sr: "Serbian" } as const;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Cuts a description that overran the word budget at the last full sentence that fits.
 *
 * Prompt v1 asked for 60–120 words and the model exceeded 120 in 14 of 30 evaluated
 * generations (eval/results/descriptions.v1.md), always by overshooting, never by falling
 * short. The prompt was tightened in v2, and this is the guarantee behind it: whatever the
 * model does, the client receives at most `maxWords`, ending on a sentence rather than
 * mid-clause the way a `max_tokens` cut would.
 *
 * A sentence ends at `.`, `!` or `?` followed by whitespace and a capital letter, or by
 * the end of the text. Requiring the capital is what keeps "89.5" and "approx. one" from
 * counting as ends. If not even the first sentence fits, the first `maxWords` words are
 * kept as-is — an unsentenced cut is still better than an over-length one.
 */
export function trimToWordBudget(text: string, maxWords: number = MAX_DESCRIPTION_WORDS): string {
  const trimmed = text.trim();
  if (countWords(trimmed) <= maxWords) return trimmed;

  const boundary = /[.!?]["”')\]]?(?=\s+\p{Lu}|\s*$)/gu;
  let best = "";
  for (const match of trimmed.matchAll(boundary)) {
    const candidate = trimmed.slice(0, (match.index ?? 0) + match[0].length);
    if (countWords(candidate) > maxWords) break;
    best = candidate;
  }

  return best || trimmed.split(/\s+/).slice(0, maxWords).join(" ");
}

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
    `- Between ${MIN_DESCRIPTION_WORDS} and ${MAX_DESCRIPTION_WORDS} words, in 5 to 7 sentences; about 90 words is ideal.`,
    "- Cover every fact the seller gave, each once. If that leaves the text short, add what",
    "  kind of use or buyer the item suits, or what a buyer may want to check on pickup —",
    "  never a detail about this particular item that the seller did not state.",
    "- No sales clichés, no calls to action, no filler.",
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
