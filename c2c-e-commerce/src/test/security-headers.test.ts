import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("security response headers", () => {
  it("declares the four controls the threat model claims", async () => {
    const entries = await nextConfig.headers!();
    const applied = entries.flatMap((entry) => entry.headers.map((h) => h.key.toLowerCase()));

    expect(applied).toContain("strict-transport-security");
    expect(applied).toContain("referrer-policy");
    expect(applied).toContain("x-content-type-options");
    expect(applied).toContain("content-security-policy");
  });

  it("applies them to every route", async () => {
    const entries = await nextConfig.headers!();
    // Not just "some entry somewhere" — the entry carrying source "/:path*" must be the
    // one with the four controls, or a config could declare them on a source that never
    // matches anything and this test would still pass.
    const catchAll = entries.find((entry) => entry.source === "/:path*");
    expect(catchAll).toBeDefined();

    const keys = catchAll!.headers.map((h) => h.key.toLowerCase());
    expect(keys).toContain("strict-transport-security");
    expect(keys).toContain("referrer-policy");
    expect(keys).toContain("x-content-type-options");
    expect(keys).toContain("content-security-policy");
  });
});
