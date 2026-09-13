import { NextRequest } from "next/server";

import { getLlmProvider, LlmError } from "@/lib/ai/llm";
import { buildDescriptionPrompt, trimToWordBudget } from "@/lib/ai/prompts";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { AI_RATE_LIMIT, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { jsonError, jsonOk } from "@/lib/response";
import { GenerateDescriptionSchema, parseRequest } from "@/lib/validation";

/** Defensive cap on what we hand back, whatever the model does (AC8). */
const MAX_DESCRIPTION_CHARS = 2000;

/**
 * Upper bound on generated tokens.
 *
 * AI-1's D1 amendment measured qwen/qwen3.8-27b producing a 56-word description in 67
 * completion tokens, so this is generous headroom while making a runaway generation
 * impossible. Unlike the gpt-oss models rejected in AI-1, qwen has no reasoning channel to
 * swallow the budget, so a cap cannot silently yield empty text.
 */
const MAX_TOKENS = 400;

/**
 * @swagger
 * /api/listings/generate-description:
 *   post:
 *     tags: [Listings]
 *     summary: Generate a listing description with a language model
 *     description: >
 *       Turns a product title, and optionally some keywords and a category, into a
 *       marketplace description the seller can edit before saving. Nothing is stored —
 *       the client posts the edited text to the normal create route.
 *
 *       The model is instructed not to invent specifications or prices and not to include
 *       contact details, but the output is a **draft for a human to review**, not a
 *       statement of fact about the item.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 120
 *                 example: Mountain bike
 *               keywords:
 *                 type: array
 *                 maxItems: 10
 *                 items:
 *                   type: string
 *                   maxLength: 30
 *                 example: ["26 inch", "aluminium"]
 *               categoryName:
 *                 type: string
 *                 maxLength: 60
 *                 example: Bicycles
 *               language:
 *                 type: string
 *                 enum: [en, sr]
 *                 default: en
 *     responses:
 *       200:
 *         description: A generated description
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 description:
 *                   type: string
 *                   description: At most 2000 characters.
 *                 model:
 *                   type: string
 *                   description: The model that produced the text.
 *                 generatedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid body — title length, keyword count or keyword length
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Authenticated, but not a seller or admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Generation quota exhausted for this account
 *         headers:
 *           Retry-After:
 *             schema:
 *               type: integer
 *             description: Seconds to wait before retrying
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       502:
 *         description: The language model was unreachable, timed out, or returned nothing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function POST(request: NextRequest) {
  try {
    // Order matters, and four tests assert it: every guard below has to run *before* the
    // model is called. An endpoint that validated after generating would return the right
    // status code and still spend the quota.
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    // Keyed on the user, not the IP: this endpoint is authenticated, so the budget belongs
    // to the account rather than to whoever shares its NAT. Ahead of validation, so a
    // caller cannot spend unlimited malformed requests.
    const limitResult = rateLimit(`ai:${payload.sub}`, AI_RATE_LIMIT);
    if (!limitResult.allowed) {
      return jsonError(
        "Generation limit reached. Try again later.",
        429,
        rateLimitHeaders(limitResult, AI_RATE_LIMIT),
      );
    }

    const parsed = await parseRequest(request, GenerateDescriptionSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const provider = getLlmProvider();
    const { system, user } = buildDescriptionPrompt(parsed.data);

    const completion = await provider.generate(user, {
      system,
      temperature: 0.5,
      maxTokens: MAX_TOKENS,
    });

    // Word budget first, character cap second. The prompt asks for at most 120 words, and
    // the model overshoots it often enough (see trimToWordBudget) that the promise has to
    // be kept here; the character cap then only guards against a text with no sentences.
    const description = trimToWordBudget(completion).slice(0, MAX_DESCRIPTION_CHARS);
    if (!description) {
      // A 200 carrying an empty description would look like success to the form in AI-6.
      throw new LlmError("model returned no usable text", { kind: "malformed" });
    }

    return jsonOk({
      description,
      model: provider.model,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }

    if (err instanceof LlmError) {
      // Discriminated on purpose: a programming error inside this route is a 500, not
      // "upstream is down". The kind and status are logged, never returned — the client
      // learns that generation failed, not what our provider is or how it failed.
      console.error(
        `[POST /api/listings/generate-description] llm ${err.kind}` +
          (err.status ? ` (${err.status})` : ""),
      );
      return jsonError("Description generation is unavailable. Try again later.", 502);
    }

    console.error("[POST /api/listings/generate-description]", err);
    return jsonError("Internal server error", 500);
  }
}
