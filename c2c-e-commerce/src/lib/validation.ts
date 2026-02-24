import { z } from "zod";

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Stringify the first Zod validation error into a human-readable message. */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map((e) => e.message).join("; ");
}

/**
 * Safely parse `body` against `schema`.
 * Returns `{ data, error: null }` on success, or `{ data: null, error }` on failure.
 */
export function parseBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown
): { data: T; error: null } | { data: null; error: string } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return { data: null, error: formatZodError(result.error) };
  }
  return { data: result.data, error: null };
}

// ─── Price transformer (shared) ───────────────────────────────────────────────

const priceField = z
  .union([z.string(), z.number()])
  .transform((val, ctx) => {
    const num = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(num) || num < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "price must be a non-negative number" });
      return z.NEVER;
    }
    return num;
  });

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const RegisterBodySchema = z.object({
  email: z.string().email("email must be a valid email address"),
  password: z.string().min(8, "password must be at least 8 characters"),
  name: z.string().min(1, "name is required"),
  role: z.enum(["buyer", "seller"], {
    error: "role must be 'buyer' or 'seller'",
  }).default("buyer"),
});

export const LoginBodySchema = z.object({
  email: z.string().min(1, "email is required"),
  password: z.string().min(1, "password is required"),
});

// ─── Categories ───────────────────────────────────────────────────────────────

export const CreateCategorySchema = z.object({
  name: z.string().min(1, "name is required"),
  slug: z.string().min(1, "slug is required"),
  description: z.string().nullable().optional(),
});

export const UpdateCategorySchema = z
  .object({
    name: z.string().min(1, "name must be a non-empty string").optional(),
    slug: z.string().min(1, "slug must be a non-empty string").optional(),
    description: z.string().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No updatable fields provided",
  });

// ─── Listings ─────────────────────────────────────────────────────────────────

export const CreateListingSchema = z.object({
  title: z.string().min(1, "title is required"),
  description: z.string().min(1, "description is required"),
  price: priceField,
  imageUrl: z
    .string()
    .trim()
    .url("imageUrl must be a valid URL")
    .startsWith("http", "imageUrl must start with http or https")
    .nullable()
    .optional(),
  categoryId: z.number().int().nullable().optional(),
});

export const UpdateListingSchema = z
  .object({
    title: z.string().min(1, "title must be a non-empty string").optional(),
    description: z
      .string()
      .min(1, "description must be a non-empty string")
      .optional(),
    price: priceField.optional(),
    imageUrl: z
      .string()
      .trim()
      .url("imageUrl must be a valid URL")
      .startsWith("http", "imageUrl must start with http or https")
      .nullable()
      .optional(),
    categoryId: z.number().int().nullable().optional(),
    status: z.enum(["active", "sold", "removed"], {
      error: "status must be one of: active, sold, removed",
    }).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No updatable fields provided",
  });

// ─── Orders ───────────────────────────────────────────────────────────────────

export const OrderItemSchema = z.object({
  listingId: z.number().int("listingId must be an integer"),
  quantity: z
    .number()
    .int()
    .min(1, "quantity must be a positive integer")
    .default(1),
});

export const CreateOrderSchema = z.object({
  items: z.array(OrderItemSchema).min(1, "items must be a non-empty array"),
});

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(
    ["pending", "paid", "shipped", "completed", "cancelled"],
    {
      error: "status must be one of: pending, paid, shipped, completed, cancelled",
    }
  ),
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

export const CreateReviewSchema = z.object({
  rating: z
    .number()
    .int()
    .min(1, "rating must be an integer between 1 and 5")
    .max(5, "rating must be an integer between 1 and 5"),
  comment: z.string().nullable().optional(),
});

// ─── Users ────────────────────────────────────────────────────────────────────

export const UpdateUserSchema = z
  .object({
    name: z.string().min(1, "name must be a non-empty string").optional(),
    phoneNumber: z.string().nullable().optional(),
    password: z
      .string()
      .min(8, "password must be at least 8 characters")
      .optional(),
    role: z
      .enum(["buyer", "seller", "admin"], {
        error: "role must be one of: buyer, seller, admin",
      })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No updatable fields provided",
  });
