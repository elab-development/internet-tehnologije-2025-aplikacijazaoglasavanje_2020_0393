/**
 * Automatic checks over a generated listing description, for chapter 8.3.
 *
 * Each check is one of the rules the prompt in `src/lib/ai/prompts.ts` states. Only the
 * rules a regular expression can decide are here: length, no price, no contact or link,
 * plain text. "No invented characteristics" and "usable as-is" need a human reading the
 * output against the input, and the results sheet leaves those two columns blank for that.
 *
 * The checks are deliberately strict in the direction of *reporting* a violation: a
 * description that says "priced fairly" trips the price check although it names no figure.
 * A false positive here costs one glance at the sheet; a false negative would count a
 * rule-breaking description as compliant in a table the thesis quotes.
 */

export const MIN_WORDS = 60;
export const MAX_WORDS = 120;

export type CheckName = "length" | "noPrice" | "noContact" | "plainText";

export type CheckResult = {
  words: number;
  /** Which of the automatic checks passed. */
  passed: Record<CheckName, boolean>;
  /** The fragment that tripped each failing check, for the sheet. */
  evidence: Partial<Record<CheckName, string>>;
};

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * A figure with a currency around it, a currency word alone, or a "price" phrase.
 *
 * The prompt forbids *stating or estimating* a price, so the words are matched as well as
 * the symbols: "around 200 euros", "cena 15 000 dinara", "priced to sell" all count. Bare
 * numbers do not — "128 GB" and "26 inch" are exactly what a description should repeat.
 */
const PRICE_PATTERNS: RegExp[] = [
  /[€$£]\s?\d/u,
  /\d\s?(?:€|\$|£|eur|usd|rsd|din\b)/iu,
  /\b(?:euros?|evra|evro|dollars?|dinara|dinar|rsd|eur)\b/iu,
  /\b(?:price[ds]?|cena|cene|cenu|cijena|košta|kosta)\b/iu,
  // "costs" only next to an amount or an estimate: "no additional setup costs" names none.
  /\bcosts?\s+(?:about|around|roughly|only|just|under|over|[€$£]|\d)/iu,
  /\b(?:bargain|povoljno|jeftino|cheap|affordable|budget[- ]friendly)\b/iu,
];

/**
 * E-mail, URL, phone number, or an invitation to take the deal off the platform.
 * Phone: seven or more digits with optional separators, after an optional plus or zero.
 */
const CONTACT_PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.]+/u,
  /\bhttps?:\/\/|\bwww\./iu,
  /(?:\+|\b0)\d[\d\s/-]{6,}\d/u,
  /\b(?:viber|whatsapp|telegram|instagram|facebook|dm me|pm me|call me|pozovite|pozovi|javite se|kontakt)\b/iu,
];

/** Markdown structure the prompt forbids: headings, bullets, emphasis, quotes around it. */
const MARKUP_PATTERNS: RegExp[] = [
  /^\s*#{1,6}\s/mu,
  /^\s*(?:[-*•]|\d+\.)\s+/mu,
  /\*\*[^*]+\*\*/u,
  /^["“][\s\S]*["”]$/u,
];

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return m[0].trim();
  }
  return undefined;
}

export function checkDescription(text: string): CheckResult {
  const words = countWords(text);
  const price = firstMatch(text, PRICE_PATTERNS);
  const contact = firstMatch(text, CONTACT_PATTERNS);
  const markup = firstMatch(text, MARKUP_PATTERNS);

  const evidence: CheckResult["evidence"] = {};
  if (words < MIN_WORDS || words > MAX_WORDS) evidence.length = `${words} words`;
  if (price) evidence.noPrice = price;
  if (contact) evidence.noContact = contact;
  if (markup) evidence.plainText = markup;

  return {
    words,
    passed: {
      length: !evidence.length,
      noPrice: !price,
      noContact: !contact,
      plainText: !markup,
    },
    evidence,
  };
}

export const CHECK_NAMES: CheckName[] = ["length", "noPrice", "noContact", "plainText"];

/** Every automatic check passed. */
export function isCompliant(result: CheckResult): boolean {
  return CHECK_NAMES.every((name) => result.passed[name]);
}
