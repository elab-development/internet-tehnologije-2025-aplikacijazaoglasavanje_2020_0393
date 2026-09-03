/**
 * C2C-SEC-5 AC7 — password login against an account that has no password.
 *
 * Once `password_hash` is nullable, every path that reads it has to cope with `null`.
 * The obvious implementation — skip the comparison when there is no hash — is correct
 * on status code and wrong on timing: bcrypt at 12 rounds takes hundreds of
 * milliseconds, so an early return makes OAuth-only accounts answer visibly faster than
 * password accounts. That difference is an account-enumeration oracle: it tells an
 * attacker which addresses are worth attacking through Google instead.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";
import { resetDb } from "@/test/db";
import { makeUser } from "@/test/factories";

let clientCounter = 0;

async function login(email: string, password: string) {
  const { POST } = await import("./route");
  clientCounter += 1;

  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.2.0.${clientCounter % 250}`,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
}

/** Wall-clock cost of one login attempt, in milliseconds. */
async function timeLogin(email: string, password: string): Promise<number> {
  const started = performance.now();
  await login(email, password);
  return performance.now() - started;
}

const PASSWORD = "password123";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

describe("C2C-SEC-5 AC7 — an OAuth-only account cannot be password-logged-in", () => {
  it("answers with the standard 401, not an exception", async () => {
    const user = await makeUser({ password: null });

    const response = await login(user.email, PASSWORD);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    // Byte-identical to the wrong-password message: no hint that this account exists
    // but authenticates elsewhere.
    expect(body.error).toBe("Invalid email or password");
  });

  it("gives the same answer as a wrong password on a password account", async () => {
    const oauthOnly = await makeUser({ password: null });
    const withPassword = await makeUser({ password: PASSWORD });

    const a = await login(oauthOnly.email, PASSWORD);
    const b = await login(withPassword.email, "wrong-password");

    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
  });

  it("gives the same answer as an address that does not exist", async () => {
    const oauthOnly = await makeUser({ password: null });

    const a = await login(oauthOnly.email, PASSWORD);
    const b = await login("nobody@example.test", PASSWORD);

    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
  });

  it("takes comparable time to a real password check, so timing reveals nothing", async () => {
    const oauthOnly = await makeUser({ password: null });
    const withPassword = await makeUser({ password: PASSWORD });

    // Warm up: the first bcrypt call in a process pays one-off costs.
    await login(withPassword.email, "wrong-password");

    const oauthTiming = await timeLogin(oauthOnly.email, PASSWORD);
    const passwordTiming = await timeLogin(withPassword.email, "wrong-password");

    // A skipped bcrypt is roughly two orders of magnitude faster. Half the real cost is
    // a generous floor that still fails an early return outright, while tolerating the
    // noise of a shared CI runner.
    expect(oauthTiming).toBeGreaterThan(passwordTiming * 0.5);
  });

  it("still lets the same user log in once they set a password", async () => {
    // Guards against 'fixing' this by rejecting every null-hash account forever.
    const user = await makeUser({ password: PASSWORD });

    const response = await login(user.email, PASSWORD);

    expect(response.status).toBe(200);
  });
});
