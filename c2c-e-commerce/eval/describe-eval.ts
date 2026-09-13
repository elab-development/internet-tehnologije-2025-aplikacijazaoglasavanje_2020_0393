/**
 * Generated-description evaluation for chapter 8.3, and its latency for 8.4.
 *
 *   npx tsx eval/describe-eval.ts [--repeats 2] [--lang en|sr] [--dry-run]
 *
 * Runs the same prompt and the same generation parameters as
 * `POST /api/listings/generate-description` over a fixed set of inputs, then checks every
 * output against the rules the prompt states and times every call. The route itself is not
 * exercised: what is measured is the model behind it, without the HTTP, authentication and
 * rate-limit layers, which together add single-digit milliseconds to a call that takes
 * seconds. The route's own behaviour is covered by its tests.
 *
 * `--repeats N` generates each input N times (default 2, so 30 calls for 15 inputs). Two
 * things need the repeats: a p95 over 15 numbers is the second-slowest call and nothing
 * more, and at temperature 0.5 a single sample per input says little about how often a
 * rule is broken.
 *
 * `--dry-run` calls nothing. It runs the automatic checks over known-good and known-bad
 * texts and prints the inputs, which is how a change to `describe-checks.ts` is verified.
 *
 * Needs `GROQ_API_KEY` (read from the repository's `.env`, then `.env.local` here), and
 * spends one call per generation.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import * as dotenv from "dotenv";

import { GroqProvider } from "@/lib/ai/llm";
import { buildDescriptionPrompt, DESCRIPTION_PROMPT_VERSION, trimToWordBudget } from "@/lib/ai/prompts";
import type { DescriptionPromptInput } from "@/lib/ai/prompts";

import {
  CHECK_NAMES,
  checkDescription,
  isCompliant,
  MAX_WORDS,
  MIN_WORDS,
  type CheckName,
  type CheckResult,
} from "./describe-checks";

// Same lookup as `load-env.ts`, minus its DATABASE_URL demand — this script needs no
// database. `.env.local` second, so a key kept only there is found too.
dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
dotenv.config({ path: path.resolve(__dirname, "../.env.local"), quiet: true });

const OUT_DIR = path.resolve(__dirname, "results");

/** Mirror of the route's constants; the route does not export them. */
const TEMPERATURE = 0.5;
const MAX_TOKENS = 400;
const MAX_DESCRIPTION_CHARS = 2000;

/** Target from the backlog, quoted in chapter 8.4. */
const LATENCY_TARGET_MS = 5_000;

// ─── Inputs ───────────────────────────────────────────────────────────────────

/**
 * Fifteen inputs in the shape the endpoint accepts: a title, some keywords, a category.
 *
 * Not taken from `corpus.ts`: those rows already carry a description, and the endpoint's
 * job is to write one from less than that. Spread over the categories of the seed, with a
 * few chosen to tempt a rule violation — a title that is itself a number, a keyword that
 * invites a spec the seller never gave, a vague title with almost nothing to go on. The
 * measurement is worth little on inputs the model cannot get wrong.
 */
type EvalInput = DescriptionPromptInput & { id: string; note?: string };

const INPUTS: EvalInput[] = [
  { id: "d01", title: "iPhone 13, 128 GB, unlocked", keywords: ["battery 89%", "no scratches", "charging cable"], categoryName: "Smartphones" },
  { id: "d02", title: "ThinkPad T480 business laptop", keywords: ["i5", "16 GB RAM", "256 GB SSD"], categoryName: "Laptops" },
  { id: "d03", title: "Mountain bike, 26 inch", keywords: ["aluminium frame", "21 gears", "front suspension"], categoryName: "Bicycles" },
  { id: "d04", title: "IKEA Kallax shelf, 4x4", keywords: ["white", "disassembled", "pickup only"], categoryName: "Furniture" },
  { id: "d05", title: "Winter jacket, men's size L", keywords: ["down filling", "worn one season"], categoryName: "Clothing" },
  { id: "d06", title: "Canon EOS 250D with 18-55 kit lens", keywords: ["shutter count 4000", "two batteries"], categoryName: "Cameras" },
  { id: "d07", title: "PlayStation 4 Slim 500 GB", keywords: ["two controllers", "three games"], categoryName: "Gaming" },
  { id: "d08", title: "Espresso machine with steam wand", keywords: ["descaled", "no leaks"], categoryName: "Home appliances" },
  { id: "d09", title: "Yamaha acoustic guitar", keywords: ["gig bag", "new strings"], categoryName: "Music" },
  { id: "d10", title: "Baby stroller, foldable", keywords: ["rain cover", "used for one child"], categoryName: "Kids" },
  // Tempting inputs
  { id: "d11", title: "Old phone", categoryName: "Smartphones", note: "almost no information — invites invention" },
  { id: "d12", title: "Golf 5 alloy wheels, set of four", keywords: ["16 inch", "tyres included"], categoryName: "Car parts", note: "keywords invite tyre size, tread and brand" },
  { id: "d13", title: "Gaming PC, RTX 3060", keywords: ["custom build", "runs everything"], categoryName: "Computers", note: "'runs everything' invites benchmarks and a spec list" },
  { id: "d14", title: "Kitchen table with four chairs", keywords: ["solid wood", "quick sale"], categoryName: "Furniture", note: "'quick sale' invites a price or a bargain claim" },
  { id: "d15", title: "Textbooks for first year economics", keywords: ["FON", "complete set", "message me for the list"], categoryName: "Books", note: "keyword invites off-platform contact" },
];

// ─── CLI ──────────────────────────────────────────────────────────────────────

function readArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function readRepeats(): number {
  const value = Number(readArg("--repeats"));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
}

function readLanguage(): "en" | "sr" {
  const value = readArg("--lang");
  if (value === "sr") return "sr";
  return "en";
}

// ─── Measurement ──────────────────────────────────────────────────────────────

/** Nearest-rank, as in bench.ts: a reported p95 is a call that actually happened. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

type Sample = {
  input: EvalInput;
  repeat: number;
  /** What the route would return: trimmed to the word budget. */
  description: string;
  /** What the model actually produced, before `trimToWordBudget`. */
  raw: string;
  ms: number;
  /** Checks over the model's own output — the number that says how well the prompt works. */
  check: CheckResult;
  /** Checks over the trimmed text — what a seller sees. */
  checkTrimmed: CheckResult;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One generation, timed, reproducing what the route does with the completion.
 *
 * A 429 from Groq is the free tier's per-minute cap, not a finding about the model, so it
 * is waited out and retried once rather than recorded as a failure.
 */
async function generateOnce(provider: GroqProvider, input: EvalInput, language: "en" | "sr"): Promise<{ raw: string; description: string; ms: number }> {
  const { system, user } = buildDescriptionPrompt({ ...input, language });

  const attempt = async () => {
    const started = performance.now();
    const completion = await provider.generate(user, { system, temperature: TEMPERATURE, maxTokens: MAX_TOKENS });
    const ms = performance.now() - started;
    const raw = completion.trim();
    return { raw, description: trimToWordBudget(raw).slice(0, MAX_DESCRIPTION_CHARS), ms };
  };

  try {
    return await attempt();
  } catch (err) {
    if (err instanceof Error && "status" in err && (err as { status?: number }).status === 429) {
      console.log("   429 from Groq — waiting 20 s and retrying once");
      await sleep(20_000);
      return attempt();
    }
    throw err;
  }
}

// ─── Dry run ──────────────────────────────────────────────────────────────────

/** Fixed texts with a known verdict; a failing line here means the checks changed. */
function selfTest(): void {
  const sixtyWords = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const cases: { text: string; expectFail: CheckName[] }[] = [
    { text: sixtyWords, expectFail: [] },
    { text: "Too short.", expectFail: ["length"] },
    { text: `${sixtyWords} ${sixtyWords} extra`, expectFail: ["length"] },
    { text: `${sixtyWords} yours for €120.`, expectFail: ["noPrice"] },
    { text: `${sixtyWords} around 200 euros.`, expectFail: ["noPrice"] },
    { text: `${sixtyWords} cena 15000 dinara.`, expectFail: ["noPrice"] },
    { text: `${sixtyWords} priced to sell.`, expectFail: ["noPrice"] },
    { text: `${sixtyWords} 128 GB storage, 26 inch wheels.`, expectFail: [] },
    { text: `${sixtyWords} no additional setup costs.`, expectFail: [] },
    { text: `${sixtyWords} it costs about 200.`, expectFail: ["noPrice"] },
    { text: `${sixtyWords} call 064 123 4567.`, expectFail: ["noContact"] },
    { text: `${sixtyWords} write to me@example.com.`, expectFail: ["noContact"] },
    { text: `${sixtyWords} message me on Viber.`, expectFail: ["noContact"] },
    { text: `${sixtyWords}\n- bullet point`, expectFail: ["plainText"] },
    { text: `## Heading\n${sixtyWords}`, expectFail: ["plainText"] },
    { text: `${sixtyWords} **bold** claim`, expectFail: ["plainText"] },
    { text: `"${sixtyWords}"`, expectFail: ["plainText"] },
  ];

  let failures = 0;
  for (const c of cases) {
    const result = checkDescription(c.text);
    const failed = CHECK_NAMES.filter((n) => !result.passed[n]);
    const ok = failed.length === c.expectFail.length && failed.every((n) => c.expectFail.includes(n));
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} expected [${c.expectFail.join(",")}] got [${failed.join(",")}] — ${c.text.slice(-40).replace(/\n/g, "⏎")}`);
  }

  console.log(`\n${cases.length - failures}/${cases.length} check fixtures behave as expected.`);
  console.log(`\n${INPUTS.length} inputs, ${readRepeats()} repeat(s) each → ${INPUTS.length * readRepeats()} Groq calls on a real run.`);
  if (failures > 0) process.exit(1);
}

// ─── Report ───────────────────────────────────────────────────────────────────

const CHECK_LABEL: Record<CheckName, string> = {
  length: `${MIN_WORDS}–${MAX_WORDS} words`,
  noPrice: "no price",
  noContact: "no contact / link",
  plainText: "plain text",
};

function mark(ok: boolean): string {
  return ok ? "✓" : "✗";
}

function writeReport(samples: Sample[], opts: { model: string; language: string; repeats: number; generatedAt: string }): string {
  const lines: string[] = [];
  const say = (s = "") => lines.push(s);

  const n = samples.length;
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  const p50 = percentile(times, 50);
  const p95 = percentile(times, 95);
  const words = samples.map((s) => s.check.words).sort((a, b) => a - b);

  say(`# Generated descriptions — evaluation\n`);
  say(`| | |`);
  say(`|---|---|`);
  say(`| Model | \`${opts.model}\` |`);
  say(`| Prompt version | \`${DESCRIPTION_PROMPT_VERSION}\` |`);
  say(`| Temperature / max tokens | ${TEMPERATURE} / ${MAX_TOKENS} |`);
  say(`| Language | ${opts.language} |`);
  say(`| Inputs × repeats | ${INPUTS.length} × ${opts.repeats} = **${n}** descriptions |`);
  say(`| Run | ${opts.generatedAt}, Node ${process.version} |`);
  say();
  say(`Measured with the route's prompt and parameters but without its HTTP, authentication`);
  say(`and rate-limit layers; see the header of \`eval/describe-eval.ts\`.\n`);

  // ── Summary: automatic checks ──
  const trimmedCount = samples.filter((s) => s.raw !== s.description).length;
  say(`## Automatic checks\n`);
  say(`"Model output" is the completion as the model produced it — the measure of the prompt.`);
  say(`"After trim" is the text the route returns, once \`trimToWordBudget\` has cut any`);
  say(`overrun at the last full sentence within ${MAX_WORDS} words.\n`);
  say(`| Rule | Model output | Share | After trim | Share |`);
  say(`|---|---|---|---|---|`);
  for (const name of CHECK_NAMES) {
    const passed = samples.filter((s) => s.check.passed[name]).length;
    const passedTrimmed = samples.filter((s) => s.checkTrimmed.passed[name]).length;
    say(`| ${CHECK_LABEL[name]} | ${passed} / ${n} | ${((100 * passed) / n).toFixed(0)} % | ${passedTrimmed} / ${n} | ${((100 * passedTrimmed) / n).toFixed(0)} % |`);
  }
  const compliant = samples.filter((s) => isCompliant(s.check)).length;
  const compliantTrimmed = samples.filter((s) => isCompliant(s.checkTrimmed)).length;
  say(`| **all four** | **${compliant} / ${n}** | **${((100 * compliant) / n).toFixed(0)} %** | **${compliantTrimmed} / ${n}** | **${((100 * compliantTrimmed) / n).toFixed(0)} %** |`);
  say();
  say(`Model output word count: min ${words[0]}, median ${percentile(words, 50)}, max ${words[words.length - 1]}. ` +
    `The trim was needed on ${trimmedCount} of ${n} descriptions.`);
  say();
  say(`Faithfulness (nothing invented) and usability (postable without edits) are not`);
  say(`automatic — they are judged by hand in the per-description table below, column by column.\n`);

  // ── Summary: latency ──
  say(`## Latency\n`);
  say(`| n | p50 (ms) | p95 (ms) | min | max | target |`);
  say(`|---|---|---|---|---|---|`);
  say(`| ${n} | ${p50.toFixed(0)} | ${p95.toFixed(0)} | ${times[0].toFixed(0)} | ${times[times.length - 1].toFixed(0)} | p95 < ${LATENCY_TARGET_MS} ms: **${p95 < LATENCY_TARGET_MS ? "met" : "NOT met"}** |`);
  say();

  // ── Per-input table ──
  say(`## Per description\n`);
  say(`Hand-judged columns are left blank: fill *faithful* (no characteristic the seller did`);
  say(`not state) and *usable* (postable without edits) as ✓ / ✗ after reading each text.\n`);
  say(`Words are the model's own count; a second figure after → is the count after the trim.\n`);
  say(`| # | Input | Rep | Words | ${CHECK_NAMES.map((c) => CHECK_LABEL[c]).join(" | ")} | ms | Faithful | Usable |`);
  say(`|---|---|---|---|${CHECK_NAMES.map(() => "---").join("|")}|---|---|---|`);
  for (const s of samples) {
    const wordsCell = s.raw === s.description ? `${s.check.words}` : `${s.check.words} → ${s.checkTrimmed.words}`;
    say(
      `| ${s.input.id} | ${s.input.title} | ${s.repeat} | ${wordsCell} | ` +
        CHECK_NAMES.map((c) => mark(s.check.passed[c])).join(" | ") +
        ` | ${s.ms.toFixed(0)} |  |  |`,
    );
  }
  say();

  // ── Full texts ──
  say(`## Texts\n`);
  say(`Every output verbatim, for choosing the examples chapter 8.3 quotes.\n`);
  for (const s of samples) {
    const failed = CHECK_NAMES.filter((c) => !s.check.passed[c]);
    say(`### ${s.input.id} / ${s.repeat} — ${s.input.title}\n`);
    say(`- Category: ${s.input.categoryName ?? "—"}`);
    say(`- Keywords: ${s.input.keywords?.length ? s.input.keywords.map((k) => `"${k}"`).join(", ") : "—"}`);
    if (s.input.note) say(`- Why this input: ${s.input.note}`);
    say(`- ${s.check.words} words, ${s.ms.toFixed(0)} ms, ${failed.length === 0 ? "all checks passed" : `failed: ${failed.map((c) => `${CHECK_LABEL[c]} (${s.check.evidence[c]})`).join("; ")}`}`);
    say();
    say(`> ${s.raw.replace(/\n/g, "\n> ")}`);
    say();
    if (s.raw !== s.description) {
      say(`After the trim (${s.checkTrimmed.words} words), the seller sees:\n`);
      say(`> ${s.description.replace(/\n/g, "\n> ")}`);
      say();
    }
  }

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes("--dry-run")) {
    selfTest();
    return;
  }

  const repeats = readRepeats();
  const language = readLanguage();
  mkdirSync(OUT_DIR, { recursive: true });

  // Constructed here, not via getLlmProvider(): a run that silently used the mock would
  // produce a sheet full of deterministic filler with a perfect score.
  const provider = new GroqProvider();
  console.log(`Model ${provider.model}, prompt ${DESCRIPTION_PROMPT_VERSION}, language ${language}, ${INPUTS.length} × ${repeats} calls\n`);

  const samples: Sample[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const input of INPUTS) {
      const { raw, description, ms } = await generateOnce(provider, input, language);
      const check = checkDescription(raw);
      const checkTrimmed = checkDescription(description);
      samples.push({ input, repeat, description, raw, ms, check, checkTrimmed });
      const failed = CHECK_NAMES.filter((c) => !check.passed[c]);
      const trimmedNote = raw !== description ? ` → trimmed to ${checkTrimmed.words}` : "";
      console.log(
        `${input.id}/${repeat} ${ms.toFixed(0).padStart(5)} ms  ${String(check.words).padStart(3)} w  ${failed.length ? "✗ " + failed.join(",") : "✓"}${trimmedNote}`,
      );
    }
  }

  const generatedAt = new Date().toISOString();
  const report = writeReport(samples, { model: provider.model, language, repeats, generatedAt });
  // Versioned, so a prompt change adds a file beside the old one instead of replacing it.
  const suffix = `.${DESCRIPTION_PROMPT_VERSION}${language === "en" ? "" : `.${language}`}`;

  writeFileSync(path.join(OUT_DIR, `descriptions${suffix}.md`), report, "utf8");
  writeFileSync(
    path.join(OUT_DIR, `descriptions${suffix}.raw.json`),
    JSON.stringify(
      {
        model: provider.model,
        promptVersion: DESCRIPTION_PROMPT_VERSION,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
        language,
        repeats,
        generatedAt,
        samples: samples.map((s) => ({
          id: s.input.id,
          repeat: s.repeat,
          input: { title: s.input.title, keywords: s.input.keywords ?? [], categoryName: s.input.categoryName },
          raw: s.raw,
          description: s.description,
          trimmed: s.raw !== s.description,
          ms: Math.round(s.ms),
          words: s.check.words,
          wordsAfterTrim: s.checkTrimmed.words,
          passed: s.check.passed,
          passedAfterTrim: s.checkTrimmed.passed,
          evidence: s.check.evidence,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  console.log(
    `\n${samples.filter((s) => isCompliant(s.check)).length}/${samples.length} model outputs pass all automatic checks, ` +
      `${samples.filter((s) => isCompliant(s.checkTrimmed)).length}/${samples.length} after the trim; ` +
      `p50 ${percentile(times, 50).toFixed(0)} ms, p95 ${percentile(times, 95).toFixed(0)} ms.`,
  );
  console.log(`Wrote results/descriptions${suffix}.md and results/descriptions${suffix}.raw.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
