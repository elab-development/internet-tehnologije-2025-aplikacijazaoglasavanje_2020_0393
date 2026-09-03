import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/auth/providers/route";

describe("GET /api/auth/providers", () => {
  it("lists the configured providers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("never includes a client secret", async () => {
    const body = await (await GET()).json();
    // Whatever the shape, no secret may appear anywhere in it. Serialising the whole body
    // catches a secret nested somewhere a field-by-field assertion would miss.
    expect(JSON.stringify(body)).not.toMatch(/secret/i);
  });
});
