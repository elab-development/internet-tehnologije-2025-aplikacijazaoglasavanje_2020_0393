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
  UpdateReviewSchema,
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

  it("accepts a string price and keeps it as a canonical decimal string", () => {
    const result = CreateListingSchema.safeParse({
      title: "Item",
      description: "Desc",
      price: "49.99",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe("49.99");
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

describe("UpdateReviewSchema", () => {
  it("accepts a rating alone", () => {
    const parsed = UpdateReviewSchema.safeParse({ rating: 4 });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ rating: 4 });
  });

  it("accepts a comment alone, trimmed", () => {
    const parsed = UpdateReviewSchema.safeParse({ comment: "  fine  " });
    expect(parsed.success && parsed.data).toEqual({ comment: "fine" });
  });

  it("treats a blank comment as clearing it", () => {
    const parsed = UpdateReviewSchema.safeParse({ comment: "   " });
    expect(parsed.success && parsed.data).toEqual({ comment: null });
  });

  it("refuses an empty body", () => {
    // Otherwise a PATCH with no fields would report success having changed nothing.
    expect(UpdateReviewSchema.safeParse({}).success).toBe(false);
  });

  it("refuses a rating outside 1-5, the same as on create", () => {
    expect(UpdateReviewSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(UpdateReviewSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(UpdateReviewSchema.safeParse({ rating: 3.5 }).success).toBe(false);
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

// ─── priceField ───────────────────────────────────────────────────────────────

describe("priceField", () => {
  // Exercised through the schema that uses it, because that is how every route sees it.
  const parse = (price: unknown) =>
    CreateListingSchema.safeParse({
      title: "A bicycle",
      description: "A well-kept bicycle",
      price,
      categoryId: 1,
    });

  it("accepts a plain decimal and keeps it exact", () => {
    const result = parse("1234.56");
    expect(result.success).toBe(true);
    // A string, not a number: the value must never round-trip through a float on its way
    // to a numeric(10,2) column.
    expect(result.success && result.data.price).toBe("1234.56");
  });

  it("accepts an integer and canonicalises it", () => {
    const result = parse(1200);
    expect(result.success && result.data.price).toBe("1200.00");
  });

  it("accepts one decimal place and pads it", () => {
    const result = parse("19.5");
    expect(result.success && result.data.price).toBe("19.50");
  });

  it("accepts zero", () => {
    expect(parse("0").success).toBe(true);
  });

  // The Critical. "1e400" is Infinity, which the old parseFloat guard let through to a
  // numeric column that accepts it.
  it.each(["1e400", "Infinity", "-Infinity", "NaN"])("rejects %o", (price) => {
    expect(parse(price).success).toBe(false);
  });

  it("rejects a value above what numeric(10,2) can hold", () => {
    // 10 digits total, 2 after the point, so 99999999.99 is the ceiling. The old code let
    // this reach Postgres and turned an out-of-range price into a 500.
    const result = parse("100000000.00");
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toMatch(/too large/i);
  });

  it("accepts exactly the ceiling", () => {
    expect(parse("99999999.99").success).toBe(true);
  });

  // Silent rounding is a correctness bug with a human cost: the seller typed one price
  // and the marketplace charged another, with no complaint anywhere.
  it("rejects more than two decimal places rather than rounding", () => {
    const result = parse("19.999");
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toMatch(
      /at most 2 decimal places/i,
    );
  });

  it("rejects negative prices", () => {
    expect(parse("-0.01").success).toBe(false);
    expect(parse(-5).success).toBe(false);
  });

  it.each(["", "   ", "abc", "12.34.56", "1,234.56", "0x10", "12e2"])(
    "rejects the malformed value %o",
    (price) => {
      expect(parse(price).success).toBe(false);
    },
  );

  it.each([19.99, 16.99, 0.07, 1234.56, 99999999.99])(
    "accepts the JSON number %o",
    (price) => {
      expect(parse(price).success).toBe(true);
    },
  );

  it("gives a number and its own string form the same verdict", () => {
    // The property that makes the two branches impossible to drift apart. This is the
    // assertion that fails if anyone re-derives decimal places arithmetically.
    for (const value of [19.99, 16.99, 0.07, 19.5, 1200, 0.01, 99999999.99]) {
      expect(parse(value).success).toBe(parse(String(value)).success);
    }
  });

  it("rejects a number carrying more precision than money has", () => {
    expect(parse(0.1 + 0.2).success).toBe(false); // 0.30000000000000004
    expect(parse(19.999).success).toBe(false);
  });
});
