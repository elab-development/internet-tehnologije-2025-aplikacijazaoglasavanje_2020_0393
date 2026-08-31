import { describe, expect, it } from "vitest";

import {
  clientIdentityFrom,
  trustedProxyHops,
  type ClientIdentity,
} from "@/lib/client-ip";

// The whole point of this module is that the client's own header cannot decide who the
// client is. Each case below is a row of the topology table in §3.1 of the spec.
describe("clientIdentityFrom", () => {
  const ip = (value: string): ClientIdentity => ({ kind: "ip", value });
  const untrusted: ClientIdentity = { kind: "untrusted" };

  it("reads the client from a single-proxy chain", () => {
    // client -> P1 -> app. P1 appends the address it saw, so the list is just the client.
    expect(clientIdentityFrom("203.0.113.7", null, 1)).toEqual(ip("203.0.113.7"));
  });

  it("reads the client from a two-proxy chain", () => {
    // client -> P1 -> P2 -> app. P1 appended the client, P2 appended P1.
    expect(clientIdentityFrom("203.0.113.7, 10.0.0.1", null, 2)).toEqual(
      ip("203.0.113.7"),
    );
  });

  it("ignores a prefix the client wrote themselves", () => {
    // The attacker sent `X-Forwarded-For: 1.2.3.4`; the one real proxy appended their
    // actual address. Counting from the right is what discards the forgery.
    expect(clientIdentityFrom("1.2.3.4, 203.0.113.7", null, 1)).toEqual(
      ip("203.0.113.7"),
    );
  });

  it("ignores an arbitrarily long forged prefix", () => {
    const forged = Array.from({ length: 50 }, (_, i) => `1.2.3.${i}`).join(", ");
    expect(clientIdentityFrom(`${forged}, 203.0.113.7`, null, 1)).toEqual(
      ip("203.0.113.7"),
    );
  });

  it("trusts nothing when no proxy is configured", () => {
    // hops = 0 is the default. There is no proxy, so the header is pure user input.
    expect(clientIdentityFrom("203.0.113.7", null, 0)).toEqual(untrusted);
    expect(clientIdentityFrom("203.0.113.7", "203.0.113.7", 0)).toEqual(untrusted);
  });

  it("refuses to guess when the header is shorter than configured", () => {
    // Two proxies configured, one entry present: either the header was stripped or the
    // hop count is wrong. Both are misconfiguration, and neither is a client address.
    expect(clientIdentityFrom("203.0.113.7", null, 2)).toEqual(untrusted);
    expect(clientIdentityFrom(null, null, 1)).toEqual(untrusted);
  });

  it("falls back to x-real-ip only when a proxy is trusted", () => {
    expect(clientIdentityFrom(null, "203.0.113.7", 1)).toEqual(ip("203.0.113.7"));
    expect(clientIdentityFrom(null, "203.0.113.7", 0)).toEqual(untrusted);
  });

  it("tolerates whitespace and empty entries", () => {
    expect(clientIdentityFrom("  1.2.3.4 ,  , 203.0.113.7  ", null, 1)).toEqual(
      ip("203.0.113.7"),
    );
  });

  it("treats a whitespace-only header as absent", () => {
    expect(clientIdentityFrom("   ", null, 1)).toEqual(untrusted);
  });
});

describe("trustedProxyHops", () => {
  it("defaults to zero when unset", () => {
    expect(trustedProxyHops(undefined)).toBe(0);
  });

  it("parses a positive integer", () => {
    expect(trustedProxyHops("1")).toBe(1);
    expect(trustedProxyHops(" 2 ")).toBe(2);
  });

  // Fails closed on every malformed value: a typo must not silently enable trust.
  it.each(["", "-1", "1.5", "one", "1abc", "0x1"])(
    "falls back to zero for %o",
    (raw) => {
      expect(trustedProxyHops(raw)).toBe(0);
    },
  );
});
