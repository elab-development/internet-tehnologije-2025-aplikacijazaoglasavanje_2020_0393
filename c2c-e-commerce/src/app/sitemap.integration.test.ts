/**
 * D9 — the sitemap advertises only what is for sale. Against a real database because
 * `activeListingsForSitemap` is a query, not pure logic, and the whole point of this
 * suite is to pin the boundary between "publicly readable" (reserved/sold, per
 * `listingForMetadata`) and "worth advertising to a crawler" (active only).
 */
import { beforeEach, describe, expect, it } from "vitest";

import robots from "./robots";
import sitemap from "./sitemap";
import { resetDb } from "@/test/db";
import { makeListing } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

describe("D9 — the sitemap advertises only what is for sale", () => {
  it("includes an active listing", async () => {
    const listing = await makeListing({ status: "active" });
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toContainEqual(
      expect.stringContaining(`/listings/${listing.id}`),
    );
  });

  it("excludes reserved and sold listings, which are readable but not for sale", async () => {
    const reserved = await makeListing({ status: "reserved" });
    const sold = await makeListing({ status: "sold" });
    const urls = (await sitemap()).map((e) => e.url).join(" ");
    expect(urls).not.toContain(`/listings/${reserved.id}`);
    expect(urls).not.toContain(`/listings/${sold.id}`);
  });

  it("excludes drafts", async () => {
    const draft = await makeListing({ status: "draft" });
    expect((await sitemap()).map((e) => e.url).join(" ")).not.toContain(
      `/listings/${draft.id}`,
    );
  });

  it("includes the public static routes but not the private ones", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/listings"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/orders"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/settings"))).toBe(false);
  });
});

describe("robots", () => {
  it("keeps crawlers out of the API and the private segments", () => {
    const { rules } = robots();
    const disallow = Array.isArray(rules) ? rules[0].disallow : rules.disallow;
    expect(disallow).toEqual(
      expect.arrayContaining(["/api/", "/orders", "/settings", "/seller"]),
    );
  });

  it("points at the sitemap", () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
