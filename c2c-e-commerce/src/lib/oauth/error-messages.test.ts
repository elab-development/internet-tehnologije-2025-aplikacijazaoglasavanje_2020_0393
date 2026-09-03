/**
 * C2C-SEC-9 AC4/AC5 spec — turning a callback error code into something a person can act on.
 *
 * Every code the callback can redirect with (SEC-7) has to land as its own message. A
 * shared "Something went wrong" would be the easy implementation and a bad one: the
 * user who cancelled, the user whose cookie was blocked, and the user whose provider
 * email is unverified each need to do something different next.
 */
import { describe, expect, it } from "vitest";

import { OAUTH_ERROR_CODES, oauthErrorMessage } from "./error-messages";

describe("C2C-SEC-9 AC5 — every code has its own message", () => {
  it("covers exactly the codes the callback can send", () => {
    // Kept in lockstep with CallbackError in the callback route; a new code there
    // without a message here would render as nothing at all.
    expect([...OAUTH_ERROR_CODES].sort()).toEqual([
      "cancelled",
      "email_unverified",
      "expired",
      "invalid_state",
      "provider_error",
    ]);
  });

  it("gives a distinct message per code", () => {
    const messages = OAUTH_ERROR_CODES.map((code) => oauthErrorMessage(code));

    expect(new Set(messages).size).toBe(OAUTH_ERROR_CODES.length);
  });

  it("never renders a raw identifier", () => {
    // Checking `not.toContain(code)` would be wrong: "You cancelled the sign-in"
    // properly contains the word "cancelled". What must not appear is a code-shaped
    // token — a snake_case identifier the user has no way to interpret.
    for (const code of OAUTH_ERROR_CODES) {
      expect(oauthErrorMessage(code)).not.toMatch(/[a-z]+_[a-z_]+/);
    }
  });

  it("never says only 'something went wrong'", () => {
    for (const code of OAUTH_ERROR_CODES) {
      expect(oauthErrorMessage(code)?.toLowerCase()).not.toMatch(
        /^something went wrong\.?$/,
      );
    }
  });

  it("writes a full sentence for each, not a fragment", () => {
    for (const code of OAUTH_ERROR_CODES) {
      const message = oauthErrorMessage(code)!;
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/[.!]$/);
    }
  });
});

describe("C2C-SEC-9 AC4 — the individual codes", () => {
  it("explains a cancelled sign-in without calling it an error", () => {
    const message = oauthErrorMessage("cancelled")!;

    // The user chose this. Telling them it failed is wrong.
    expect(message).toMatch(/cancel/i);
    expect(message).not.toMatch(/error|failed|wrong/i);
  });

  it("tells the user to try again when the transaction expired", () => {
    expect(oauthErrorMessage("expired")).toMatch(/again/i);
  });

  it("explains invalid_state without security jargon", () => {
    const message = oauthErrorMessage("invalid_state")!;

    expect(message).toMatch(/again/i);
    // "CSRF" and "state parameter" mean nothing to the person reading this.
    expect(message).not.toMatch(/CSRF|state parameter|token/i);
  });

  it("says what to do about an unverified provider email", () => {
    const message = oauthErrorMessage("email_unverified")!;

    // This one is actionable at the provider, not here, so it has to say so.
    expect(message).toMatch(/verif/i);
    expect(message.length).toBeGreaterThan(40);
  });

  it("does not blame the user for a provider failure", () => {
    expect(oauthErrorMessage("provider_error")).toMatch(/again|later/i);
  });
});

describe("C2C-SEC-9 — unknown input", () => {
  it("returns null for a code it does not know", () => {
    // Rendering nothing beats rendering an attacker-chosen string from the query.
    expect(oauthErrorMessage("<script>alert(1)</script>")).toBeNull();
    expect(oauthErrorMessage("totally-made-up")).toBeNull();
  });

  it("returns null for absent input", () => {
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage(undefined)).toBeNull();
    expect(oauthErrorMessage("")).toBeNull();
  });
});
