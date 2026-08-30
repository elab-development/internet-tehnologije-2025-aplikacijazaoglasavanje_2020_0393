/**
 * Spec §4.3 — create-as-draft.
 *
 * ListingForm's submit handler is create-as-draft → upload each file → publish. That
 * only works if the server actually persists `status: "draft"` from the create call —
 * a component test asserting what the client *sent* would pass even if the server
 * silently discarded the field, which is exactly what happened here: Zod strips unknown
 * keys, so an unrecognised `status` on the create body vanished and every listing was
 * created `active`, image-less, and publicly visible from the first response onward.
 *
 * These tests observe the persisted row, not the request.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { signToken } from "@/lib/auth";
import { resetDb } from "@/test/db";
import { makeUser } from "@/test/factories";

let sellerToken: string;

beforeEach(async () => {
  await resetDb();
  const seller = await makeUser({ role: "seller" });
  sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
});

async function createListing(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/listings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/listings — create-as-draft", () => {
  it("persists status: draft when the caller requests it", async () => {
    const response = await createListing({
      title: "Half-finished listing",
      description: "Photos still uploading",
      price: 10,
      status: "draft",
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: number };

    const [row] = await db.select().from(listings).where(eq(listings.id, created.id));

    expect(row.status).toBe("draft");
  });

  it("persists status: active when the caller omits status", async () => {
    const response = await createListing({
      title: "A normal listing",
      description: "Published immediately",
      price: 10,
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: number };

    const [row] = await db.select().from(listings).where(eq(listings.id, created.id));

    expect(row.status).toBe("active");
  });

  it("rejects any status other than draft at creation time", async () => {
    const response = await createListing({
      title: "Sneaky listing",
      description: "Trying to skip straight to sold",
      price: 10,
      status: "sold",
    });

    expect(response.status).toBe(400);
  });
});
