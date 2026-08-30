import { describe, it, expect } from "vitest";
import { ORDER_STATUSES } from "@/lib/order-lifecycle";
import {
  formatZodError,
  parseBody,
  parseRequest,
  RegisterBodySchema,
  LoginBodySchema,
  CreateCategorySchema,
  UpdateCategorySchema,
  CreateListingSchema,
  UpdateListingSchema,
  CreateOrderSchema,
  CreateReviewSchema,
  UpdateOrderStatusSchema,
  UpdateUserSchema,
} from "./validation";
import { z } from "zod";

// ─── formatZodError ───────────────────────────────────────────────────────────

describe("formatZodError", () => {
  it("should join multiple issues with semicolons", () => {
    const schema = z.object({
      a: z.string(),
      b: z.number(),
    });
    const result = schema.safeParse({ a: 123, b: "not-a-number" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toContain(";");
    }
  });

  it("should return a single message for a single issue", () => {
    const schema = z.object({ email: z.string().email("bad email") });
    const result = schema.safeParse({ email: "not-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toBe("bad email");
    }
  });
});

// ─── parseBody ────────────────────────────────────────────────────────────────

describe("parseBody", () => {
  const schema = z.object({ name: z.string().min(1, "name is required") });

  it("returns data on valid input", () => {
    const result = parseBody(schema, { name: "Test" });
    expect(result.data).toEqual({ name: "Test" });
    expect(result.error).toBeNull();
  });

  it("returns error on invalid input", () => {
    const result = parseBody(schema, { name: "" });
    expect(result.data).toBeNull();
    expect(result.error).toBe("name is required");
  });

  it("returns error when body is null", () => {
    const result = parseBody(schema, null);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

// ─── RegisterBodySchema ───────────────────────────────────────────────────────

describe("RegisterBodySchema", () => {
  it("accepts valid registration data", () => {
    const data = {
      email: "user@example.com",
      password: "password123",
      name: "John Doe",
    };
    const result = RegisterBodySchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("buyer"); // default
    }
  });

  it("accepts seller role", () => {
    const data = {
      email: "seller@example.com",
      password: "password123",
      name: "Seller",
      role: "seller",
    };
    const result = RegisterBodySchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("seller");
    }
  });

  it("rejects short password", () => {
    const data = {
      email: "user@example.com",
      password: "short",
      name: "John",
    };
    const result = RegisterBodySchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const data = {
      email: "not-an-email",
      password: "password123",
      name: "John",
    };
    const result = RegisterBodySchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const data = {
      email: "user@example.com",
      password: "password123",
      name: "John",
      role: "admin",
    };
    const result = RegisterBodySchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

// ─── LoginBodySchema ──────────────────────────────────────────────────────────

describe("LoginBodySchema", () => {
  it("accepts valid login data", () => {
    const result = LoginBodySchema.safeParse({
      email: "user@example.com",
      password: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty email", () => {
    const result = LoginBodySchema.safeParse({ email: "", password: "pass" });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = LoginBodySchema.safeParse({
      email: "user@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});

// ─── CreateCategorySchema ─────────────────────────────────────────────────────

describe("CreateCategorySchema", () => {
  it("accepts valid category", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Electronics",
      slug: "electronics",
    });
    expect(result.success).toBe(true);
  });

  it("accepts category with description", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Electronics",
      slug: "electronics",
      description: "Electronic devices and gadgets",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing slug", () => {
    const result = CreateCategorySchema.safeParse({ name: "Electronics" });
    expect(result.success).toBe(false);
  });
});

// ─── CreateListingSchema ──────────────────────────────────────────────────────

describe("CreateListingSchema", () => {
  it("accepts valid listing", () => {
    const result = CreateListingSchema.safeParse({
      title: "iPhone 15",
      description: "Brand new iPhone",
      price: 999.99,
    });
    expect(result.success).toBe(true);
  });

  it("accepts string price and transforms to number", () => {
    const result = CreateListingSchema.safeParse({
      title: "Item",
      description: "Desc",
      price: "49.99",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe(49.99);
    }
  });

  it("rejects negative price", () => {
    const result = CreateListingSchema.safeParse({
      title: "Item",
      description: "Desc",
      price: -10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const result = CreateListingSchema.safeParse({
      description: "Desc",
      price: 10,
    });
    expect(result.success).toBe(false);
  });
});

// ─── UpdateListingSchema ──────────────────────────────────────────────────────

describe("UpdateListingSchema", () => {
  it("rejects an empty object (no updatable fields)", () => {
    const result = UpdateListingSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a status-only update", () => {
    const result = UpdateListingSchema.safeParse({ status: "sold" });
    expect(result.success).toBe(true);
  });
});

// ─── CreateOrderSchema ────────────────────────────────────────────────────────

describe("CreateOrderSchema", () => {
  it("accepts a single listing id", () => {
    expect(CreateOrderSchema.safeParse({ listingId: 5 }).success).toBe(true);
  });

  it("rejects the old cart-shaped body", () => {
    // `{ items: [...] }` is what the UI sent before D1. A body that silently parses to
    // nothing would place an order against listing `undefined`.
    expect(CreateOrderSchema.safeParse({ items: [{ listingId: 5 }] }).success).toBe(false);
  });

  it("rejects a zero or negative listing id", () => {
    expect(CreateOrderSchema.safeParse({ listingId: 0 }).success).toBe(false);
    expect(CreateOrderSchema.safeParse({ listingId: -3 }).success).toBe(false);
  });
});

// ─── CreateReviewSchema ───────────────────────────────────────────────────────

describe("CreateReviewSchema", () => {
  it("accepts valid review", () => {
    const result = CreateReviewSchema.safeParse({
      rating: 5,
      comment: "Great product!",
    });
    expect(result.success).toBe(true);
  });

  it("accepts review without comment", () => {
    const result = CreateReviewSchema.safeParse({ rating: 3 });
    expect(result.success).toBe(true);
  });

  it("rejects rating below 1", () => {
    const result = CreateReviewSchema.safeParse({ rating: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects rating above 5", () => {
    const result = CreateReviewSchema.safeParse({ rating: 6 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer rating", () => {
    const result = CreateReviewSchema.safeParse({ rating: 3.5 });
    expect(result.success).toBe(false);
  });
});

// ─── UpdateUserSchema ─────────────────────────────────────────────────────────

describe("UpdateUserSchema", () => {
  it("accepts valid partial update", () => {
    const result = UpdateUserSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("rejects empty object (no updatable fields)", () => {
    const result = UpdateUserSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts role update", () => {
    const result = UpdateUserSchema.safeParse({ role: "seller" });
    expect(result.success).toBe(true);
  });
});

// ─── parseRequest ─────────────────────────────────────────────────────────────

describe("parseRequest", () => {
  const schema = z.object({ name: z.string().min(1) });

  function jsonRequest(body: string): Request {
    return new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }

  it("returns parsed data for a valid body", async () => {
    const result = await parseRequest(jsonRequest('{"name":"Test"}'), schema);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ name: "Test" });
  });

  it("reports schema violations", async () => {
    const result = await parseRequest(jsonRequest('{"name":""}'), schema);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("reports malformed JSON instead of throwing", async () => {
    // Previously request.json() threw and handlers answered 500 for what is a
    // client mistake.
    const result = await parseRequest(jsonRequest("{not json"), schema);
    expect(result.data).toBeNull();
    expect(result.error).toBe("Invalid JSON body");
  });

  it("reports an empty body as malformed rather than crashing", async () => {
    const result = await parseRequest(jsonRequest(""), schema);
    expect(result.data).toBeNull();
    expect(result.error).toBe("Invalid JSON body");
  });

  it("rejects a JSON scalar where an object is required", async () => {
    const result = await parseRequest(jsonRequest("null"), schema);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

// ─── UpdateOrderStatusSchema ──────────────────────────────────────────────────

describe("UpdateOrderStatusSchema", () => {
  it("accepts every status the graph names", () => {
    for (const status of ORDER_STATUSES) {
      expect(UpdateOrderStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects the statuses this part removed", () => {
    for (const status of ["paid", "approved", "rejected"]) {
      expect(UpdateOrderStatusSchema.safeParse({ status }).success).toBe(false);
    }
  });

  it("rejects an unknown status", () => {
    expect(UpdateOrderStatusSchema.safeParse({ status: "shipped-ish" }).success).toBe(false);
  });
});

// ─── Registration role and phone ──────────────────────────────────────────────

describe("RegisterBodySchema role restrictions", () => {
  const base = { email: "a@example.com", password: "password123", name: "A" };

  it("refuses to mint an admin", () => {
    expect(RegisterBodySchema.safeParse({ ...base, role: "admin" }).success).toBe(false);
  });

  it("defaults to buyer", () => {
    const result = RegisterBodySchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.role).toBe("buyer");
  });

  it("keeps the phone number the register form sends", () => {
    const result = RegisterBodySchema.safeParse({ ...base, phoneNumber: " +381601234567 " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phoneNumber).toBe("+381601234567");
  });

  it("requires a valid email", () => {
    expect(RegisterBodySchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });
});

describe("Part 1 — category tree fields", () => {
  it("accepts a parentId on create", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Phones",
      slug: "phones",
      parentId: 3,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.parentId).toBe(3);
  });

  it("accepts an explicit null parentId, meaning a root", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Electronics",
      slug: "electronics",
      parentId: null,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.parentId).toBeNull();
  });

  it("leaves parentId undefined when it is not sent", () => {
    const result = CreateCategorySchema.safeParse({ name: "Books", slug: "books" });

    expect(result.success).toBe(true);
    expect(result.success && result.data.parentId).toBeUndefined();
  });

  it("rejects a non-integer parentId", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Phones",
      slug: "phones",
      parentId: 1.5,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative parentId", () => {
    expect(
      CreateCategorySchema.safeParse({ name: "a", slug: "a", parentId: 0 }).success,
    ).toBe(false);
    expect(
      CreateCategorySchema.safeParse({ name: "a", slug: "a", parentId: -1 }).success,
    ).toBe(false);
  });

  it("accepts sortOrder on update", () => {
    const result = UpdateCategorySchema.safeParse({ sortOrder: 5 });

    expect(result.success).toBe(true);
    expect(result.success && result.data.sortOrder).toBe(5);
  });

  it("still rejects an empty update body", () => {
    expect(UpdateCategorySchema.safeParse({}).success).toBe(false);
  });
});
