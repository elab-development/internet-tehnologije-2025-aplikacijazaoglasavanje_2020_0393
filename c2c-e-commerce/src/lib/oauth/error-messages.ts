// ─── Callback error messages ──────────────────────────────────────────────────
// One message per code the OAuth callback can redirect with (C2C-SEC-9).
//
// Kept as data, in one place, because the alternative — a chain of ternaries inside the
// login page — is where a new code quietly ends up rendering nothing.

/** Every code the callback route can produce. Mirrors `CallbackError` there. */
export const OAUTH_ERROR_CODES = [
  "invalid_state",
  "expired",
  "cancelled",
  "provider_error",
  "email_unverified",
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

const MESSAGES: Record<OAuthErrorCode, string> = {
  // The user chose this. Calling it a failure would be both wrong and irritating.
  cancelled: "You cancelled the sign-in, so nothing was changed.",

  // Genuinely retry-able: usually a slow return, sometimes blocked third-party cookies.
  expired:
    "That sign-in took too long to complete. Please try again.",

  // No jargon: "CSRF" and "state parameter" mean nothing to the person reading this,
  // and naming them would only worry someone who cannot act on it.
  invalid_state:
    "We could not verify that sign-in came from this browser. Please try again.",

  // Not the user's fault, so it does not read like an accusation.
  provider_error:
    "The sign-in provider could not be reached. Please try again in a moment.",

  // The only fix is at the provider, so the message has to send them there.
  email_unverified:
    "Your email address is not verified with that provider. Verify it there and try again, or sign in with your password.",
};

function isKnown(code: string): code is OAuthErrorCode {
  return (OAUTH_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * The message for a callback error code, or null when there is nothing to say.
 *
 * Null for an unrecognised code rather than a fallback string: this value arrives from
 * the query string, so echoing it — even inside a template — would put attacker-chosen
 * text on the page.
 */
export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return isKnown(code) ? MESSAGES[code] : null;
}
