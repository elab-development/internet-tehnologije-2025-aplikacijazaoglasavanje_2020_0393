/**
 * C2C-AI-5 spec — AC9: the endpoint is documented.
 *
 * Asserted against the generated spec rather than by opening /api-docs, so the criterion
 * is verified by a test rather than by inspection — which the Definition of Done requires
 * of every AC.
 */
import { describe, expect, it } from "vitest";

import spec from "@/lib/swagger-spec.json";

type Operation = {
  tags?: string[];
  security?: unknown[];
  requestBody?: { content: Record<string, { schema: unknown }> };
  responses: Record<string, unknown>;
};

const paths = (spec as { paths: Record<string, { post?: Operation }> }).paths;
const PATH = "/api/listings/generate-description";

describe("C2C-AI-5 — AC9: /api-docs documents the endpoint", () => {
  it("AC9: the path exists with a POST operation", () => {
    expect(Object.keys(paths)).toContain(PATH);
    expect(paths[PATH]?.post).toBeDefined();
  });

  it("AC9: it is listed under the Listings tag", () => {
    expect(paths[PATH]!.post!.tags).toContain("Listings");
  });

  it("AC9: it documents a request schema", () => {
    const content = paths[PATH]!.post!.requestBody?.content;
    expect(content?.["application/json"]?.schema).toBeDefined();
  });

  it("AC9: it documents every status the route can answer", () => {
    const responses = Object.keys(paths[PATH]!.post!.responses);

    // The full set the ACs demand — a 502 that is not documented is a surprise to a
    // client that has to handle it.
    for (const status of ["200", "400", "401", "403", "429", "502"]) {
      expect(responses).toContain(status);
    }
  });

  it("AC9: it declares that authentication is required", () => {
    expect(paths[PATH]!.post!.security).toBeDefined();
  });

  it("AC7: the 429 documents its Retry-After header", () => {
    const tooMany = paths[PATH]!.post!.responses["429"] as {
      headers?: Record<string, unknown>;
    };
    expect(tooMany.headers?.["Retry-After"]).toBeDefined();
  });
});
