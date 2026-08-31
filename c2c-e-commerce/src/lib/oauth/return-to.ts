// ─── returnTo ─────────────────────────────────────────────────────────────────
// Open-redirect protection for the post-login landing path (C2C-SEC-7 AC10).

/** Where a user lands when no safe destination was captured. */
export const DEFAULT_RETURN_TO = "/";

// Control characters and all whitespace. The old predicate was written with RAW control
// bytes rather than escapes -- a literal NUL, a literal DEL, and the text `\s` -- which is
// why every reader, including this plan's first draft, misread it. It was really
// `[\x00-\x1f\x7f\s]`, and it did NOT reject `/link-account`.
//
// The real gap was the C1 block (U+0080-U+009F). Keep `\s` so the 18 whitespace
// codepoints the old class covered -- plain space, NBSP, the U+2000 block, U+FEFF -- stay
// covered; dropping it would be a regression hiding inside a readability cleanup, and
// would contradict this function's own docstring.
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]|\s/;

/**
 * Reduces a caller-supplied `returnTo` to a same-site path, or the default.
 *
 * "Starts with a slash" is the check people reach for and it is not enough. Three
 * things get through it:
 *
 *   `//evil.test/x`   protocol-relative — the browser reads it as an absolute URL
 *   `/\evil.test`     some parsers normalise the backslash to a slash, giving the above
 *   `/%09//evil.test` leading control characters that are stripped before parsing
 *
 * So this allows exactly one shape: a single leading slash followed by something that
 * is not another slash or a backslash. Anything else — absolute URLs, schemes,
 * whitespace, control characters — falls back to the default rather than being
 * "cleaned up", because a sanitiser that rewrites hostile input tends to be one clever
 * encoding away from being wrong again.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return DEFAULT_RETURN_TO;

  // Control characters and whitespace anywhere: reject rather than trim. A browser
  // strips some of these before parsing, so trimming would change what is being judged.
  if (FORBIDDEN_CHARACTERS.test(value)) return DEFAULT_RETURN_TO;

  if (!value.startsWith("/")) return DEFAULT_RETURN_TO;
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_RETURN_TO;

  return value;
}
