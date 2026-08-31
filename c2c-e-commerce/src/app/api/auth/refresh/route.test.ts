/**
 * C2C-SEC-3 AC10 / C2C-SEC-11 AC6 regression — what a failed refresh does to the cookie.
 *
 * The end-to-end rotation behaviour is covered by route.integration.test.ts against a
 * real database. This file isolates one branch that test cannot reach sequentially: the
 * *loser* of a concurrent rotation, and whether its response deletes a cookie that the
 * winner has already replaced.
 *
 * `rotateRefreshToken` is stubbed so each failure reason can be provoked on demand;
 * everything the route does with the outcome is real.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REFRESH_COOKIE } from "@/lib/refresh-cookies";
import { RefreshTokenError, type RefreshTokenFailure } from "@/lib/refresh-token";
import { resetRateLimits } from "@/lib/rate-limit";

const rotateRefreshToken = vi.hoisted(() => vi.fn());

vi.mock("@/lib/refresh-token", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/refresh-token")>()),
  rotateRefreshToken,
}));

// Never reached on these paths — the route throws before any lookup — but the module is
// imported at load time and must not open a pool.
vi.mock("@/db", () => ({ db: {} }));

let clientCounter = 0;
const nextIp = () => `10.9.0.${(clientCounter += 1) % 250}`;

/** The `set-cookie` value for `name`, or undefined if the response does not set it. */
function setCookie(response: Response, name: string): string | undefined {
  const raw = response.headers.getSetCookie?.() ?? [];
  const all = raw.length > 0 ? raw : [response.headers.get("set-cookie") ?? ""];
  return all.find((c) => c.startsWith(`${name}=`));
}

async function refreshWith(reason: RefreshTokenFailure) {
  rotateRefreshToken.mockRejectedValueOnce(new RefreshTokenError(reason, reason));

  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/auth/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": nextIp(),
        cookie: `${REFRESH_COOKIE}=stale-but-presented`,
      },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
});

describe("C2C-SEC-3 AC10 — losing a concurrent rotation", () => {
  it("leaves the refresh cookie alone", async () => {
    const response = await refreshWith("concurrent");

    expect(response.status).toBe(401);
    // The cookie jar is shared across tabs. The sibling that won the race has already
    // written the successor into it, so clearing here would delete a live credential and
    // sign the user out for the crime of opening two tabs.
    expect(setCookie(response, REFRESH_COOKIE)).toBeUndefined();
  });

  it("still says nothing about why it failed", async () => {
    const response = await refreshWith("concurrent");

    await expect(response.json()).resolves.toMatchObject({
      error: "Not authenticated",
    });
  });
});

describe("C2C-SEC-3 — a genuinely spent token", () => {
  it.each<RefreshTokenFailure>(["not_found", "expired", "revoked", "reused"])(
    "clears the refresh cookie on %s",
    async (reason) => {
      const response = await refreshWith(reason);

      expect(response.status).toBe(401);

      // Nothing has replaced this cookie, so leaving it in place only guarantees the
      // next request repeats the same failure.
      const cleared = setCookie(response, REFRESH_COOKIE);
      expect(cleared).toBeDefined();
      expect(cleared).toMatch(/Max-Age=0/i);
    },
  );
});
