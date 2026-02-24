import { describe, it, expect } from "vitest";
import {
  formatZodError,
  parseBody,
  RegisterBodySchema,
  LoginBodySchema,
  CreateCategorySchema,
  CreateListingSchema,
  CreateOrderSchema,
  CreateReviewSchema,
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

  it("accepts listing with imageUrl", () => {
    const result = CreateListingSchema.safeParse({
      title: "Item",
      description: "Desc",
      price: 10,
      imageUrl: "https://example.com/image.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid imageUrl", () => {
    const result = CreateListingSchema.safeParse({
      title: "Item",
      description: "Desc",
      price: 10,
      imageUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

// ─── CreateOrderSchema ────────────────────────────────────────────────────────

describe("CreateOrderSchema", () => {
  it("accepts valid order", () => {
    const result = CreateOrderSchema.safeParse({
      items: [{ listingId: 1, quantity: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it("defaults quantity to 1", () => {
    const result = CreateOrderSchema.safeParse({
      items: [{ listingId: 1 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].quantity).toBe(1);
    }
  });

  it("rejects empty items array", () => {
    const result = CreateOrderSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
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
