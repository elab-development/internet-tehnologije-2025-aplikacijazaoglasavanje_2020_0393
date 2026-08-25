import { z } from "zod";

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Stringify the first Zod validation error into a human-readable message. */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map((e) => e.message).join("; ");
}

/**
 * `ok` is the discriminant. Narrowing on `error` alone would not work: its type
 * is `string`, which includes `""`, so a truthiness test cannot rule out the
 * failure branch.
 */
export type ParseResult<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: string };

/**
 * Safely parse `body` against `schema`.
 * Returns `{ data, error: null }` on success, or `{ data: null, error }` on failure.
 */
export function parseBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown
): ParseResult<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    return { ok: false, data: null, error: formatZodError(result.error) };
  }
  return { ok: true, data: result.data, error: null };
}

/**
 * Read a JSON request body and validate it against `schema` in one step.
 *
 * Also covers the malformed-JSON case: `request.json()` throws on invalid
 * input, which handlers previously let fall through to their catch-all and
 * answer 500. A body the client got wrong is a 400.
 *
 * Keep the result boxed rather than destructuring it, and branch on `ok`:
 * narrowing `data` to non-null depends on TypeScript correlating it with a
 * discriminant check on the same object, which destructuring breaks.
 *
 * ```ts
 * const parsed = await parseRequest(request, CreateListingSchema);
 * if (!parsed.ok) return jsonError(parsed.error, 400);
 * const listing = parsed.data; // narrowed to T
 * ```
 */
export async function parseRequest<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<ParseResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, data: null, error: "Invalid JSON body" };
  }
  return parseBody(schema, body);
}

// ─── Image URL transformer (shared) ───────────────────────────────────────────

/**
 * Accepts an absolute http(s) URL, normalises it, and maps empty/blank input to
 * null. Mirrors what the listing routes did by hand: a bare `.startsWith("http")`
 * check would let `httpx://…` through, so the protocol is checked after parsing.
 */
const imageUrlField = z
  .union([z.string(), z.null()])
  .transform((val, ctx) => {
    if (val === null) return null;

    const trimmed = val.trim();
    if (!trimmed) return null;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "imageUrl must be a valid URL",
      });
      return z.NEVER;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "imageUrl must be a valid http or https URL",
      });
      return z.NEVER;
    }

    return parsed.toString();
  });

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
  phoneNumber: z.string().trim().min(1).nullable().optional(),
  // Deliberately excludes "admin": self-registration must never mint an admin.
  // Admin is granted by an existing admin via PUT /api/users/[id].
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
  name: z.string().trim().min(1, "name is required"),
  slug: z.string().trim().min(1, "slug is required"),
  description: z.string().trim().nullable().optional(),
});

export const UpdateCategorySchema = z
  .object({
    name: z.string().trim().min(1, "name must be a non-empty string").optional(),
    slug: z.string().trim().min(1, "slug must be a non-empty string").optional(),
    description: z.string().trim().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No updatable fields provided",
  });

// ─── Listings ─────────────────────────────────────────────────────────────────

export const CreateListingSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  description: z.string().trim().min(1, "description is required"),
  price: priceField,
  imageUrl: imageUrlField.optional(),
  categoryId: z.number().int().nullable().optional(),
});

export const UpdateListingSchema = z
  .object({
    title: z.string().trim().min(1, "title must be a non-empty string").optional(),
    description: z
      .string()
      .trim()
      .min(1, "description must be a non-empty string")
      .optional(),
    price: priceField.optional(),
    imageUrl: imageUrlField.optional(),
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

// Must stay in sync with orderStatusEnum in db/schema/orders.ts. "approved" and
// "rejected" were added by migration 0004 for the seller approval flow.
export const ORDER_STATUSES = [
  "pending",
  "paid",
  "shipped",
  "completed",
  "cancelled",
  "approved",
  "rejected",
] as const;

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES, {
    error: `status must be one of: ${ORDER_STATUSES.join(", ")}`,
  }),
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

export const CreateReviewSchema = z.object({
  // Accepts "5" as well as 5: the handler used Number(rating) before, and this
  // endpoint is driven from Swagger/API clients rather than the UI.
  rating: z
    .union([z.string(), z.number()])
    .transform((val, ctx) => {
      const num = Number(val);
      if (!Number.isInteger(num) || num < 1 || num > 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "rating must be an integer between 1 and 5",
        });
        return z.NEVER;
      }
      return num;
    }),
  // Blank comments are stored as null rather than an empty string.
  comment: z
    .union([z.string(), z.null()])
    .transform((val) => (val === null || !val.trim() ? null : val.trim()))
    .optional(),
});

// ─── Users ────────────────────────────────────────────────────────────────────

export const UpdateUserSchema = z
  .object({
    name: z.string().trim().min(1, "name must be a non-empty string").optional(),
    phoneNumber: z
      .union([z.string(), z.null()])
      .transform((val) => (val === null || !val.trim() ? null : val.trim()))
      .optional(),
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
