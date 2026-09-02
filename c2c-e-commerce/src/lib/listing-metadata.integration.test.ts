/**
 * generateMetadata resolves as anonymous (spec D8): it applies isPubliclyVisible and
 * nothing else. A draft must never leak its title into a <meta> tag or a link preview,
 * and reading the session here would make the served HTML vary by cookie.
 *
 * This is a security boundary, so it is tested against a real database like the API's
 * boundaries are.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { listingForMetadata, sellerForMetadata } from "./listing-metadata";
import { resetDb } from "@/test/db";
import { makeListing, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

describe("listingForMetadata", () => {
  it("returns the real title for an active listing", async () => {
    const listing = await makeListing({ title: "Blue bicycle", status: "active" });
    await expect(listingForMetadata(listing.id)).resolves.toMatchObject({
      title: "Blue bicycle",
    });
  });

  it("still returns it for reserved and sold, which are publicly readable", async () => {
    for (const status of ["reserved", "sold"] as const) {
      const listing = await makeListing({ title: `A ${status} thing`, status });
      await expect(listingForMetadata(listing.id)).resolves.not.toBeNull();
    }
  });

  it("refuses to leak a draft's title", async () => {
    const listing = await makeListing({ title: "Secret unpublished thing", status: "draft" });
    await expect(listingForMetadata(listing.id)).resolves.toBeNull();
  });

  it("returns null for a listing that does not exist", async () => {
    await expect(listingForMetadata(999_999_999)).resolves.toBeNull();
  });
});

describe("sellerForMetadata", () => {
  it("returns the seller's name", async () => {
    const seller = await makeUser({ role: "seller", name: "Ana Anić" });
    await expect(sellerForMetadata(seller.id)).resolves.toMatchObject({
      name: "Ana Anić",
    });
  });

  it("returns null for a seller that does not exist", async () => {
    await expect(sellerForMetadata(999_999_999)).resolves.toBeNull();
  });
});

it("supplies the %s that title.template was waiting for", async () => {
  const { metadata } = await import("@/app/(frontend)/settings/layout");
  expect(metadata.title).toBe("Settings");
});
