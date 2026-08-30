import { z } from "zod";

import { ORDER_STATUSES } from "@/lib/order-lifecycle";

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

/**
 * `parentId` is nullable *and* optional, and the two mean different things: an explicit
 * `null` makes the category a root, while omitting it leaves the parent untouched. Route
 * code must branch on `=== undefined`, never on falsiness.
 */
export const CreateCategorySchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  slug: z.string().trim().min(1, "slug is required"),
  description: z.string().trim().nullable().optional(),
  parentId: z
    .number()
    .int("parentId must be an integer")
    .positive("parentId must be a positive integer")
    .nullable()
    .optional(),
  sortOrder: z.number().int("sortOrder must be an integer").optional(),
});

export const UpdateCategorySchema = z
  .object({
    name: z.string().trim().min(1, "name must be a non-empty string").optional(),
    slug: z.string().trim().min(1, "slug must be a non-empty string").optional(),
    description: z.string().trim().nullable().optional(),
    parentId: z
      .number()
      .int("parentId must be an integer")
      .positive("parentId must be a positive integer")
      .nullable()
      .optional(),
    sortOrder: z.number().int("sortOrder must be an integer").optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No updatable fields provided",
  });

// ─── Listings ─────────────────────────────────────────────────────────────────

export const CreateListingSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  description: z.string().trim().min(1, "description is required"),
  price: priceField,
  categoryId: z.number().int().nullable().optional(),
  // Create-as-draft (spec §4.3): the only status a client may request at creation time.
  // `sold`/`removed` are transitions a listing reaches later, never a starting point.
  status: z.enum(["draft"], {
    error: "status must be: draft",
  }).optional(),
});

/**
 * C2C-AI-5 — body for POST /api/listings/generate-description.
 *
 * The bounds are quota control as much as validation: an unbounded title or keyword list
 * is an unbounded prompt, and the caller does not pay for the tokens.
 */
export const GenerateDescriptionSchema = z.object({
  // The field is named in every message, including the missing-value case: formatZodError
  // joins messages without their paths, so a bare `z.string()` would answer "invalid
  // input: expected string, received undefined" and leave the caller guessing which field.
  title: z
    .string({ error: "title is required" })
    .trim()
    .min(3, "title must be at least 3 characters")
    .max(120, "title must be at most 120 characters"),
  keywords: z
    .array(z.string().trim().min(1).max(30, "each keyword must be at most 30 characters"))
    .max(10, "at most 10 keywords are allowed")
    .optional(),
  categoryName: z.string().trim().max(60).optional(),
  language: z
    .enum(["en", "sr"], { error: "language must be one of: en, sr" })
    .default("en"),
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
    categoryId: z.number().int().nullable().optional(),
    status: z.enum(["draft", "active", "sold", "removed"], {
      error: "status must be one of: draft, active, sold, removed",
    }).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No updatable fields provided",
  });

// ─── Orders ───────────────────────────────────────────────────────────────────

/**
 * One order, one listing (D1).
 *
 * The old body was `{ items: [{ listingId, quantity }] }` for a cart that was never
 * built: one call site, and `quantity` was never sent a value other than the default
 * against a listing that is by construction one physical object.
 */
export const CreateOrderSchema = z.object({
  listingId: z
    .number()
    .int("listingId must be an integer")
    .positive("listingId must be a positive integer"),
});

/**
 * Accepts any status the enum holds; whether *this* caller may move *this* order there
 * is `canTransition`'s decision, not Zod's.
 */
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
