/**
 * C2C-AI-5 spec — POST /api/listings/generate-description.
 *
 * The LLM provider is wrapped rather than replaced: the deterministic mock does the work,
 * and the wrapper counts calls and can be told to fail. AC2 and AC3 both assert that *no
 * LLM call is made*, which needs the count; AC6 needs the failure.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";
import { authHeaderFor } from "@/test/auth";
import { resetDb } from "@/test/db";
import { makeUser } from "@/test/factories";

const control = vi.hoisted(() => ({
  calls: 0,
  failWith: null as null | "http" | "timeout",
  reply: null as null | string,
}));

vi.mock("@/lib/ai/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/llm")>();

  return {
    ...actual,
    getLlmProvider: () => ({
      model: "mock-llm-v1",
      generate: async (prompt: string) => {
        control.calls += 1;
        if (control.failWith === "http") {
          throw new actual.LlmError("Groq request failed with status 503", {
            kind: "http",
            status: 503,
          });
        }
        if (control.failWith === "timeout") {
          throw new actual.LlmError("Groq request timed out after 15000ms", {
            kind: "timeout",
          });
        }
        return control.reply ?? `A generated description for ${prompt.slice(0, 40)}.`;
      },
    }),
  };
});

type Body = { description?: string; model?: string; generatedAt?: string; error?: string };

async function generate(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Body; headers: Headers }> {
  const { POST } = await import("./route");
  const response = await POST(
    new NextRequest("http://localhost/api/listings/generate-description", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as Body,
    headers: response.headers,
  };
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  control.calls = 0;
  control.failWith = null;
  control.reply = null;
});

describe("C2C-AI-5 — AC1: a seller generates a description", () => {
  it("AC1: returns 200 with a non-empty description", async () => {
    const seller = await makeUser({ role: "seller" });

    const { status, body } = await generate(
      { title: "Mountain bike", keywords: ["26 inch", "aluminium"] },
      authHeaderFor(seller),
    );

    expect(status).toBe(200);
    expect(body.description).toEqual(expect.any(String));
    expect(body.description!.trim().length).toBeGreaterThan(0);
  });

  it("AC1: names the model that produced it", async () => {
    const seller = await makeUser({ role: "seller" });
    const { body } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));

    // The thesis has to be able to say which model produced a given result.
    expect(body.model).toBe("mock-llm-v1");
  });

  it("AC1: reports when it was generated, as an ISO timestamp", async () => {
    const seller = await makeUser({ role: "seller" });
    const { body } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));

    expect(body.generatedAt).toEqual(expect.any(String));
    expect(new Date(body.generatedAt!).toISOString()).toBe(body.generatedAt);
  });

  it("AC1: an admin may also generate", async () => {
    const admin = await makeUser({ role: "admin" });
    const { status } = await generate({ title: "Mountain bike" }, authHeaderFor(admin));
    expect(status).toBe(200);
  });

  it("AC1: the keywords reach the model", async () => {
    const seller = await makeUser({ role: "seller" });
    let seen = "";
    control.reply = "ok";

    const { POST } = await import("./route");
    const spy = vi.spyOn(await import("@/lib/ai/prompts"), "buildDescriptionPrompt");

    await POST(
      new NextRequest("http://localhost/api/listings/generate-description", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaderFor(seller) },
        body: JSON.stringify({ title: "Mountain bike", keywords: ["aluminium"] }),
      }),
    );

    seen = JSON.stringify(spy.mock.calls[0]?.[0] ?? {});
    expect(seen).toContain("aluminium");
    spy.mockRestore();
  });
});

describe("C2C-AI-5 — AC2/AC3: authorisation", () => {
  it("AC2: an anonymous caller is rejected with 401", async () => {
    const { status } = await generate({ title: "Mountain bike" });
    expect(status).toBe(401);
  });

  it("AC2: no LLM call is made for an anonymous caller", async () => {
    await generate({ title: "Mountain bike" });

    // The guard has to come *before* the expensive call, not merely gate the response.
    expect(control.calls).toBe(0);
  });

  it("AC3: an authenticated buyer is rejected with 403", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const { status } = await generate({ title: "Mountain bike" }, authHeaderFor(buyer));
    expect(status).toBe(403);
  });

  it("AC3: no LLM call is made for a buyer", async () => {
    const buyer = await makeUser({ role: "buyer" });
    await generate({ title: "Mountain bike" }, authHeaderFor(buyer));
    expect(control.calls).toBe(0);
  });
});

describe("C2C-AI-5 — AC4/AC5: validation", () => {
  it("AC4: a missing title is a 400 naming the field", async () => {
    const seller = await makeUser({ role: "seller" });
    const { status, body } = await generate({}, authHeaderFor(seller));

    expect(status).toBe(400);
    expect(body.error?.toLowerCase()).toContain("title");
  });

  it("AC4: a title shorter than 3 characters is a 400 naming the field", async () => {
    const seller = await makeUser({ role: "seller" });
    const { status, body } = await generate({ title: "ab" }, authHeaderFor(seller));

    expect(status).toBe(400);
    expect(body.error?.toLowerCase()).toContain("title");
  });

  it("AC4: a title longer than 120 characters is rejected", async () => {
    const seller = await makeUser({ role: "seller" });
    const { status } = await generate({ title: "x".repeat(121) }, authHeaderFor(seller));
    expect(status).toBe(400);
  });

  it("AC5: eleven keywords is a 400", async () => {
    const seller = await makeUser({ role: "seller" });
    const { status } = await generate(
      { title: "Mountain bike", keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) },
      authHeaderFor(seller),
    );
    expect(status).toBe(400);
  });

  it("AC5: exactly ten keywords is accepted", async () => {
    const seller = await makeUser({ role: "seller" });
    const { status } = await generate(
      { title: "Mountain bike", keywords: Array.from({ length: 10 }, (_, i) => `k${i}`) },
      authHeaderFor(seller),
    );
    expect(status).toBe(200);
  });

  it("AC5: a keyword longer than 30 characters is a 400", async () => {
    const seller = await makeUser({ role: "seller" });
    const { status } = await generate(
      { title: "Mountain bike", keywords: ["x".repeat(31)] },
      authHeaderFor(seller),
    );
    expect(status).toBe(400);
  });

  it("AC4/AC5: no LLM call is made for an invalid body", async () => {
    const seller = await makeUser({ role: "seller" });
    await generate({ title: "ab" }, authHeaderFor(seller));
    expect(control.calls).toBe(0);
  });

  it("accepts an unrecognised language with a 400 rather than guessing", async () => {
    const seller = await makeUser({ role: "seller" });
    const { status } = await generate(
      { title: "Mountain bike", language: "de" },
      authHeaderFor(seller),
    );
    expect(status).toBe(400);
  });

  it("accepts the two documented languages", async () => {
    const seller = await makeUser({ role: "seller" });

    for (const language of ["en", "sr"]) {
      const { status } = await generate(
        { title: "Mountain bike", language },
        authHeaderFor(seller),
      );
      expect(status).toBe(200);
    }
  });
});

describe("C2C-AI-5 — AC6: upstream failure", () => {
  it("AC6: an upstream error becomes a 502", async () => {
    const seller = await makeUser({ role: "seller" });
    control.failWith = "http";

    const { status } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    expect(status).toBe(502);
  });

  it("AC6: a timeout also becomes a 502", async () => {
    const seller = await makeUser({ role: "seller" });
    control.failWith = "timeout";

    const { status } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    expect(status).toBe(502);
  });

  it("AC6: the upstream detail does not reach the client", async () => {
    const seller = await makeUser({ role: "seller" });
    control.failWith = "http";

    const { body } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    const serialised = JSON.stringify(body);

    // Neither the provider's name, nor the status it returned, nor anything else that
    // describes our infrastructure to a caller.
    expect(serialised).not.toContain("Groq");
    expect(serialised).not.toContain("503");
    expect(serialised).not.toContain("gsk_");
  });

  it("AC6: the API key never appears in the response body", async () => {
    const seller = await makeUser({ role: "seller" });
    vi.stubEnv("GROQ_API_KEY", "gsk_sentinel_MUST_NOT_LEAK");
    control.failWith = "http";

    const { body } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    expect(JSON.stringify(body)).not.toContain("gsk_sentinel_MUST_NOT_LEAK");

    vi.unstubAllEnvs();
  });
});

describe("C2C-AI-5 — AC7: rate limiting", () => {
  it("AC7: exceeding the limit answers 429", async () => {
    const seller = await makeUser({ role: "seller" });

    let last = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    for (let i = 0; i < 30 && last.status !== 429; i++) {
      last = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    }

    expect(last.status).toBe(429);
  });

  it("AC7: the 429 carries a Retry-After header", async () => {
    const seller = await makeUser({ role: "seller" });

    let last = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    for (let i = 0; i < 30 && last.status !== 429; i++) {
      last = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    }

    expect(last.status).toBe(429);
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("AC7: a rate-limited request makes no LLM call", async () => {
    const seller = await makeUser({ role: "seller" });

    let last = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    for (let i = 0; i < 30 && last.status !== 429; i++) {
      last = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    }
    expect(last.status).toBe(429);

    // The whole point of limiting an AI endpoint: the quota must not be spent.
    const before = control.calls;
    await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    expect(control.calls).toBe(before);
  });
});

describe("C2C-AI-5 — AC8: defensive truncation", () => {
  it("AC8: a response longer than 2000 characters is truncated", async () => {
    const seller = await makeUser({ role: "seller" });
    control.reply = "x".repeat(5000);

    const { body } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    expect(body.description!.length).toBe(2000);
  });

  it("AC8: a response at the limit is left alone", async () => {
    const seller = await makeUser({ role: "seller" });
    control.reply = "y".repeat(2000);

    const { body } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    expect(body.description!.length).toBe(2000);
  });

  it("AC8: a short response is untouched", async () => {
    const seller = await makeUser({ role: "seller" });
    control.reply = "A tidy little description.";

    const { body } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    expect(body.description).toBe("A tidy little description.");
  });

  it("AC6: an empty completion is a 502, not a 200 with nothing in it", async () => {
    const seller = await makeUser({ role: "seller" });
    control.reply = "   ";

    const { status } = await generate({ title: "Mountain bike" }, authHeaderFor(seller));
    expect(status).toBe(502);
  });
});
