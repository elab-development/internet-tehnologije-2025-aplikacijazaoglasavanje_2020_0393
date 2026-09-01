# Frontend Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 57 open findings from the frontend review plus the one architectural item, without regressing the concurrency work the review identified as the codebase's best.

**Architecture:** Five waves. Wave 1 fixes the six shared primitives every other fix depends on (`api.ts`, `Button`, a new `formatPrice`, `Modal`, a new announcer, `useFetch`). Wave 2 fixes their consumers, opening each of the 19 Button files and 11 `useFetch` files exactly once. Wave 3 is the accessibility batch. Wave 4 adds the App Router special files and server segment layouts carrying metadata. Wave 5 is tests, types, dead code and polish.

**Tech Stack:** Next.js 16.1.6 App Router, React 19.2.3, TypeScript 5 strict, Tailwind, Vitest 4 (projects: `unit`, `integration` via Testcontainers, `component` via jsdom), Testing Library + `user-event`, `react-hot-toast`, Drizzle ORM 0.45, PostgreSQL 16.

**Spec:** `docs/superpowers/specs/2026-09-01-frontend-remediation-design.md`

**Branch:** `feature/frontend-remediation`, cut from `develop` @ `3707b0f`.

---

## Global Constraints

Every task's requirements implicitly include this section.

1. **Never point any command at `DATABASE_URL`.** It is the developer's own database and the migrations are destructive to it. Integration tests manage their own throwaway Testcontainers instance — you do not configure a database.
2. **Run focused projects only.** Use `npm test -- --project component`, `--project unit`, or a single file. **Never run bare `npm test`**: the full suite takes ~14 minutes against a 600-second foreground cap and will be auto-backgrounded, which looks like a hang. The controller runs the full suite at wave boundaries.
3. **A task is not done until its deliberate break has been run and the named test observed failing.** Reporting a break you did not execute is the specific failure this guards against. Restore the code afterwards and confirm the test passes again.
4. **No new runtime or dev dependencies.** `axe-core` was considered and rejected (spec §7.2). If you believe a task needs a dependency, stop and report rather than adding one.
5. **`tsc --noEmit` and `npm run lint` must be clean at every commit.** Both are fast; run them before committing.
6. **Do not weaken existing behaviour to make a test pass.** In particular the single-flight refresh in `api.ts` and the `alive` guards in `useFetch` / `useCurrencyConversion` are load-bearing; see Tasks 1 and 6.
7. **Commit per task**, with the finding IDs from the spec in the message body.

### Vitest project cheat-sheet

| Test file suffix | Project | Environment |
| --- | --- | --- |
| `*.test.ts` | `unit` | node |
| `*.integration.test.ts` | `integration` | node + Testcontainers |
| `*.component.test.tsx` | `component` | jsdom, `src/test/setup/component.ts` |

Run one file: `npm test -- --project component src/components/ui/Modal.component.test.tsx`

---

## File Structure

**New files:**

| File | Responsibility |
| --- | --- |
| `src/lib/format.ts` | `formatPrice` — the single price-rendering function |
| `src/lib/format.test.ts` | its unit tests |
| `src/components/ui/Announcer.tsx` | the one shared pair of live regions + `useAnnounce()` |
| `src/components/ui/Announcer.component.test.tsx` | its tests |
| `src/components/ui/Modal.component.test.tsx` | focus trap, Escape, scroll lock |
| `src/components/ui/Button.component.test.tsx` | disabled/loading, ARIA passthrough |
| `src/components/ui/StatusBadge.component.test.tsx` | every status word |
| `src/components/ProtectedRoute.component.test.tsx` | the auth and role gate |
| `src/lib/contrast.test.ts` | WCAG ratios + the `text-zinc-400` ban |
| `src/lib/listing-metadata.ts` | single-listing server read for `generateMetadata` |
| `src/lib/listing-metadata.integration.test.ts` | the draft-leak boundary |
| `src/app/(frontend)/error.tsx`, `not-found.tsx` | segment error + 404 |
| `src/app/global-error.tsx` | root fallback; renders its own `<html>`/`<body>` |
| `src/app/sitemap.ts`, `src/app/robots.ts` | crawler surface |
| `src/app/(frontend)/<segment>/layout.tsx` × 12 | metadata carriers for client pages |
| `src/components/ui/Card.component.test.tsx` | link semantics, footer reachability |
| `src/components/ui/FormErrorSummary.tsx` | one focusable summary per form |
| `src/hooks/useFetch.component.test.tsx` | atomic state + the race guard |
| `src/hooks/useCurrencyConversion.component.test.tsx` | timeout, cache, retry |
| `src/lib/site-url.ts` | the app's public origin for sitemap/robots |
| `src/lib/motion.test.ts` | the reduced-motion block (weakest proof, spec §7.4) |

**Modified in wave 1 and not reopened later:** `src/lib/api.ts`, `src/components/ui/Button.tsx`, `src/components/ui/Modal.tsx`, `src/hooks/useFetch.ts`, `src/app/(frontend)/layout.tsx`.

---

# Wave 1 — Shared primitives

Both remaining Criticals live here. Nothing in later waves reopens these files.

---

### Task 1: `ApiError` carries status and rate-limit headers

Closes **M1**. Spec D4.

**Files:**
- Modify: `src/lib/api.ts` (the `request` throw site at `:116-122`)
- Test: `src/lib/api.test.ts` (append; extend the `respondWith` helper at `:26-40`)

**Interfaces:**
- Consumes: nothing.
- Produces: `export class ApiError extends Error` with readonly fields `status: number`, `retryAfterSeconds: number | null`, `rateLimitRemaining: number | null`. Tasks 7, 8 and 12 branch on `status`; task 12 reads `retryAfterSeconds`.

- [ ] **Step 1: Extend the test helper to send headers**

`respondWith` currently cannot set response headers. Change its queue entry type and the `Response` construction in `src/lib/api.test.ts`:

```ts
/** A queue of canned responses, consumed in order; the last one repeats. */
function respondWith(
  ...statuses: Array<
    number | { status: number; body?: unknown; headers?: Record<string, string> }
  >
) {
  const queue = statuses.map((s) => (typeof s === "number" ? { status: s } : s));

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const spec = queue.length > 1 ? queue.shift()! : queue[0];

      return new Response(JSON.stringify(spec.body ?? { ok: true }), {
        status: spec.status,
        headers: { "content-type": "application/json", ...(spec.headers ?? {}) },
      });
    }),
  );
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/api.test.ts`:

```ts
import { api, ApiError, __resetRefreshState } from "./api";

describe("ApiError — the client preserves what the server said", () => {
  it("carries the HTTP status so callers can tell 409 from 500", async () => {
    respondWith({ status: 409, body: { error: "This listing already has an order in progress" } });

    const err = await api.post("/api/orders", { listingId: 7 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("This listing already has an order in progress");
  });

  it("parses Retry-After and X-RateLimit-Remaining on a 429", async () => {
    respondWith({
      status: 429,
      body: { error: "Too many requests" },
      headers: { "Retry-After": "45", "X-RateLimit-Remaining": "0" },
    });

    const err = (await api.get("/api/listings").catch((e: unknown) => e)) as ApiError;

    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(45);
    expect(err.rateLimitRemaining).toBe(0);
  });

  it("yields null rather than a wrong number for a non-integer Retry-After", async () => {
    // The HTTP-date form is legal but our API does not send it. Guessing would be worse
    // than admitting we do not know.
    respondWith({
      status: 429,
      body: { error: "slow down" },
      headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
    });

    const err = (await api.get("/api/listings").catch((e: unknown) => e)) as ApiError;

    expect(err.retryAfterSeconds).toBeNull();
  });

  it("is still an Error, so every existing `instanceof Error` site keeps working", async () => {
    respondWith({ status: 500, body: { error: "boom" } });

    const err = await api.get("/api/listings").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err instanceof Error ? err.message : null).toBe("boom");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- --project unit src/lib/api.test.ts`
Expected: FAIL — `ApiError` is not exported from `./api`.

- [ ] **Step 4: Implement**

In `src/lib/api.ts`, add above `type RequestOptions`:

```ts
/**
 * A failed API response, with the parts of it callers need to decide what to do next.
 *
 * Extends `Error` on purpose: every existing `err instanceof Error ? err.message : …`
 * site keeps working untouched, and branching on `status` is opt-in.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly rateLimitRemaining: number | null;

  constructor(message: string, status: number, headers: Headers) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = parseIntegerHeader(headers.get("Retry-After"));
    this.rateLimitRemaining = parseIntegerHeader(headers.get("X-RateLimit-Remaining"));
  }
}

/**
 * Reads a header that should be a non-negative integer.
 *
 * `Retry-After` also has a legal HTTP-date form. Our API never sends it, and a wrong
 * number here would be shown to the user as a countdown — so anything that is not a
 * plain integer yields null rather than a guess.
 */
function parseIntegerHeader(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}
```

Then replace the throw at `:116-122`:

```ts
  if (!res.ok) {
    const message =
      (data as { error?: string; message?: string }).error ??
      (data as { error?: string; message?: string }).message ??
      `HTTP ${res.status}`;
    throw new ApiError(message, res.status, res.headers);
  }
```

Update the file's header comment: the line "Throws a plain Error with the server's message on non-2xx responses" becomes "Throws an `ApiError` carrying the server's message, the status and the rate-limit headers".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --project unit src/lib/api.test.ts`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 6: Regression guard — prove single-flight still holds**

Global constraint 6. The existing file already covers this; confirm the named test still passes and record its name in your report:

Run: `npm test -- --project unit src/lib/api.test.ts -t "refresh"`
Expected: PASS. Every pre-existing refresh test is green.

- [ ] **Step 7: Deliberate break**

Change `parseIntegerHeader` to `return Number(trimmed)` (dropping the `/^\d+$/` guard).
Run: `npm test -- --project unit src/lib/api.test.ts -t "non-integer Retry-After"`
Expected: FAIL — the HTTP-date parses to `NaN` instead of `null`.
Then restore the guard and confirm PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat(fe): ApiError carries status and the rate-limit headers

Closes M1. The thrown Error carried only a string and res.headers was
never read, so no consumer could tell a 409 from a 429 from a 500 --
the root of both the Buy Now retry loop and the toast-for-everything
problem.

ApiError extends Error so all 11 useFetch consumers and every existing
'err instanceof Error' site keep working with no edit.

Retry-After is parsed as delta-seconds only; the legal HTTP-date form
yields null rather than a wrong countdown."
```

---

### Task 2: `ButtonProps` extends the native button attributes

Closes **M14**.

**Files:**
- Modify: `src/components/ui/Button.tsx:10-26` (the type) and the destructuring at `:50-64`
- Test: `src/components/ui/Button.component.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `ButtonProps` accepting every `React.ButtonHTMLAttributes<HTMLButtonElement>` plus `variant`, `size`, `icon`, `loading`, `fullWidth`, and a narrowed `type`. Wave 3 tasks 14–18 rely on `aria-*` props being accepted.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Button.component.test.tsx`:

```tsx
/**
 * `ButtonProps` was a closed hand-written list, so it accepted no aria-* props. Every
 * component that needed one hand-rolled a raw <button> and re-implemented the focus
 * ring, disabled styling and hover states — 17 sites, 8 of them purely for ARIA.
 * The inversion this test pins: the design system's button is the accessible one.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Button from "./Button";

describe("Button — ARIA passthrough", () => {
  it("forwards aria-label to the rendered button", () => {
    render(<Button aria-label="Close dialog" />);
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });

  it("forwards aria-expanded and aria-controls", () => {
    render(<Button aria-expanded aria-controls="panel-1">Filters</Button>);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", "panel-1");
  });

  it("forwards aria-current, which the seller tabs need", () => {
    render(<Button aria-current="page">Listings</Button>);
    expect(screen.getByRole("button", { name: "Listings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("Button — the behaviour 37 call sites already rely on", () => {
  it("is disabled while loading, so a double submit cannot fire", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the narrowed type prop", () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("still renders the explanatory title on a disabled button", () => {
    render(<Button disabled title="Add at least one photo first">Publish</Button>);
    expect(screen.getByRole("button")).toHaveAttribute(
      "title",
      "Add at least one photo first",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project component src/components/ui/Button.component.test.tsx`
Expected: FAIL — TypeScript rejects `aria-label` on `ButtonProps`, and the ARIA tests fail at runtime because the props are never spread onto the element.

- [ ] **Step 3: Implement**

Replace the type in `src/components/ui/Button.tsx`:

```tsx
export type ButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> & {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  /**
   * Native tooltip. A disabled button that does not say why it is disabled is the
   * frustrating kind — C2C-AI-6 AC5 requires the explanation.
   *
   * Declared explicitly rather than inherited only so this note survives.
   */
  title?: string;
  /** Narrowed from the native `string` so a typo cannot silently become a submit. */
  type?: "button" | "submit" | "reset";
};
```

Then change the component signature to collect the rest, and spread it:

```tsx
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    icon,
    loading = false,
    disabled = false,
    type = "button",
    children,
    className = "",
    fullWidth = false,
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={[
```

`onClick` and `title` now arrive through `...rest`, so delete them from the destructuring and delete the explicit `onClick={onClick}` and `title={title}` attributes. **`ref`, `type`, `disabled` and `className` stay after the spread** so a caller cannot accidentally override the loading-disabled behaviour that 37 sites depend on.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --project component src/components/ui/Button.component.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirm no call site broke**

Run: `npx tsc --noEmit`
Expected: clean. All 37 existing `<Button>` usages still type-check.

- [ ] **Step 6: Deliberate break**

Move `{...rest}` to *after* `disabled={isDisabled}` in the JSX.
Run: `npm test -- --project component src/components/ui/Button.component.test.tsx -t "double submit"`
Expected: FAIL — a caller-supplied `disabled` would now win over the loading guard.
Restore the spread to first position and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/Button.tsx src/components/ui/Button.component.test.tsx
git commit -m "feat(fe): ButtonProps extends the native button attributes

Closes M14. The closed prop list accepted no aria-label, aria-expanded,
aria-current or role, so every component needing one hand-rolled a raw
<button> and re-implemented the focus ring and disabled styling. The
accessible buttons were the ones that bypassed the design system.

The spread goes first so ref, type, disabled and className still win --
a caller-supplied disabled must not defeat the loading guard that 37
call sites and the double-submit tests rely on."
```

---

### Task 3: `formatPrice` — one price-rendering function

Closes **H12**. Spec D5.

**Files:**
- Create: `src/lib/format.ts`, `src/lib/format.test.ts`
- Modify: the 9 render sites listed in Step 4

**Interfaces:**
- Consumes: nothing.
- Produces: `export function formatPrice(value: number | string): string` returning `"$120.00"`. Tasks 7, 12, 14 and 32 use it.

**Critical constraint (spec D5):** output is byte-for-byte what the seven agreeing sites render today. This is a pure de-duplication with **zero visual change**. Do not reach for `Intl.NumberFormat` — it is explicitly out of scope.

- [ ] **Step 1: Write the failing test**

Create `src/lib/format.test.ts`:

```ts
/**
 * Price rendering was duplicated nine times and two of them already disagreed:
 * SimilarListings and RecommendedForYou rendered "120.00" with no currency symbol
 * while /listings rendered "$120.00" for the same listing. On a marketplace offering
 * four currencies that is ambiguous in a way that matters.
 *
 * The existing test missed it because it asserted getByText(/120/), which matches both.
 */
import { describe, expect, it } from "vitest";

import { formatPrice } from "./format";

describe("formatPrice", () => {
  it("renders exactly what the seven agreeing sites rendered before", () => {
    expect(formatPrice(120)).toBe("$120.00");
    expect(formatPrice(1500.5)).toBe("$1500.50");
    expect(formatPrice(0)).toBe("$0.00");
  });

  it("accepts the string form the API returns for numeric columns", () => {
    // Drizzle returns `numeric` as a string; every call site wrapped it in Number().
    expect(formatPrice("120.00")).toBe("$120.00");
    expect(formatPrice("1500.5")).toBe("$1500.50");
  });

  it("always shows two decimals", () => {
    expect(formatPrice(7.1)).toBe("$7.10");
    expect(formatPrice(7.999)).toBe("$8.00");
  });

  it("does not group thousands, matching the previous output", () => {
    // toLocaleString would render "1,500.50" here. Changing that is out of scope --
    // it would churn assertions across the suite for no user-visible gain.
    expect(formatPrice(1500.5)).toBe("$1500.50");
    expect(formatPrice(1500.5)).not.toContain(",");
  });

  it("renders a non-finite value as a visible placeholder, never as $NaN", () => {
    expect(formatPrice(Number.NaN)).toBe("$—");
    expect(formatPrice("not a price")).toBe("$—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project unit src/lib/format.test.ts`
Expected: FAIL — `src/lib/format.ts` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/format.ts`:

```ts
// ─── Display formatting ───────────────────────────────────────────────────────

/**
 * Renders a listing or order price in the marketplace's base currency.
 *
 * Deliberately not `Intl.NumberFormat`: this reproduces byte-for-byte what nine
 * separate call sites rendered by hand, so adopting it is a pure de-duplication with
 * no visual change. Two of those sites had already drifted — they rendered "120.00"
 * with no symbol while the rest rendered "$120.00".
 *
 * Conversion into the user's chosen currency stays with `formatConverted` in
 * `useCurrencyConversion`; this is the base-currency rendering only.
 */
export function formatPrice(value: number | string): string {
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) return "$—";
  return `$${amount.toFixed(2)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes, then adopt it at all nine sites**

Run: `npm test -- --project unit src/lib/format.test.ts` → PASS.

Now replace each site. The exact lines:

| File | Line | Was |
| --- | --- | --- |
| `src/app/(frontend)/listings/page.tsx` | 261 | `` description={`$${Number(listing.price).toFixed(2)}`} `` |
| `src/app/(frontend)/listings/page.tsx` | 271 | `${Number(listing.price).toFixed(2)}` |
| `src/app/(frontend)/listings/[id]/page.tsx` | 140-141 | `$` and `{Number(listing.price).toFixed(2)}` split across two JSX lines |
| `src/app/(frontend)/listings/[id]/page.tsx` | 193 | `${Number(listing.price).toFixed(2)}` |
| `src/app/(frontend)/orders/page.tsx` | 73 | `${Number(order.price).toFixed(2)}` |
| `src/app/(frontend)/orders/[id]/page.tsx` | 131 | `${Number(order.price).toFixed(2)}` |
| `src/app/(frontend)/users/[id]/page.tsx` | 106 | `${Number(listing.price).toFixed(2)}` |
| `src/components/orders/OrderCard.tsx` | 58 | `${price.toFixed(2)} ({formatConverted(price)})` |
| `src/components/seller/SellerListingCard.tsx` | 68 | `${Number(listing.price).toFixed(2)}` |

Each becomes `{formatPrice(listing.price)}` (or `order.price` / `price`) with
`import { formatPrice } from "@/lib/format";` added. Two need care:

- **`listings/[id]/page.tsx:140-141`** splits the `$` from the number across JSX lines. Replace both lines with a single `{formatPrice(listing.price)}` — do not leave the stray `$`.
- **`OrderCard.tsx:58`** keeps its conversion suffix: `{formatPrice(price)} ({formatConverted(price)})`.

Then the two divergent sites:

- **`src/components/listings/SimilarListings.tsx:64-67`** — replace the whole `toLocaleString` call with `{formatPrice(listing.price)}`.
- **`src/components/RecommendedForYou.tsx`** — find its price render (around `:63`) and replace it the same way.

- [ ] **Step 5: Write the test that pins the two sites that had drifted**

The existing tests assert `getByText(/120/)`, which matched both the right and the wrong output. Append to `src/components/listings/SimilarListings.component.test.tsx` and `src/components/RecommendedForYou.component.test.tsx` — adapt the existing render helper in each file rather than writing a new one:

```tsx
it("renders the price with a currency symbol, like every other surface", () => {
  // Regression: this strip rendered "120.00" while /listings rendered "$120.00"
  // for the same listing. getByText(/120/) matched both, which is why it survived.
  expect(screen.getByText("$120.00")).toBeInTheDocument();
});
```

Adjust the expected amount to whatever price the file's existing fixture uses.

- [ ] **Step 6: Run the affected component tests**

Run: `npm test -- --project component src/components/listings/SimilarListings.component.test.tsx src/components/RecommendedForYou.component.test.tsx`
Expected: PASS.

Then run the whole component project, because nine render sites changed:

Run: `npm test -- --project component`
Expected: PASS. If a pre-existing test fails on price text, the output changed — that means you introduced grouping or dropped the symbol. Fix `formatPrice`, not the test.

- [ ] **Step 7: Deliberate break**

In `formatPrice`, change the return to `` `${amount.toFixed(2)}` `` (dropping the `$`).
Run: `npm test -- --project component src/components/listings/SimilarListings.component.test.tsx -t "currency symbol"`
Expected: FAIL.
Restore and confirm PASS.

- [ ] **Step 8: Verify no hand-rolled price rendering survives**

Run: `grep -rn "toFixed(2)" src --include=*.tsx | grep -v "\.test\."`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts src/app src/components
git commit -m "feat(fe): one formatPrice, adopted at all nine render sites

Closes H12. Price rendering was duplicated nine times and two had
already drifted: the home page's recommendation strip rendered '120.00'
with no symbol while /listings rendered '\$120.00' for the same listing.
The existing tests asserted getByText(/120/), which matches both.

Output is byte-for-byte what the seven agreeing sites rendered, so this
is a pure de-duplication with no visual change. Intl.NumberFormat is
deliberately out of scope (spec D5) -- it would change output to
locale-dependent forms and churn assertions for no user-visible gain."
```

---

### Task 4: `Modal` focus management — **CRITICAL**

Closes **C2** and **L4**, plus the two latent defects found during design (spec §5). Spec D6.

**Files:**
- Modify: `src/components/ui/Modal.tsx`
- Test: `src/components/ui/Modal.component.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: no API change. `ModalProps` is unchanged; this is behaviour only.

**Background.** `dialogRef` is declared at `:29`, attached at `:72` and never read — vestigial from an abandoned focus trap. A keyboard user who opens the buy confirmation must Tab through the whole page underneath the dimmed overlay to reach "Confirm", then restarts from the top of the document after it closes. This gates the purchase flow, the review flow and the AI description replacement.

Two further defects found while designing, both fixed here because this task already rewrites these elements:
- `aria-labelledby="modal-title"` is a **hardcoded id** — two modals mounted together produce duplicate ids and the second dialog's name resolves to the first one's heading.
- `role="dialog"` sits on the **backdrop container** (`:58`), not the panel, so the overlay div is inside the dialog's accessible subtree.

**Deliberately not done (spec D6):** the background is *not* marked `inert` or `aria-hidden`. `aria-modal="true"` plus a real focus trap is what modern screen-reader and browser pairs honour, and the trap is what makes the existing `aria-modal` truthful.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Modal.component.test.tsx`:

```tsx
/**
 * Modal owned an Escape listener and a document.body.style.overflow lock but had no
 * focus management at all: no initial focus, no Tab containment, no restore on close.
 *
 * These tests drive real focus order through user-event, which jsdom supports. This is
 * the part axe-core could not have covered (spec 7.2).
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Modal from "./Modal";

function open() {
  return render(
    <>
      <button>outside before</button>
      <Modal isOpen onClose={vi.fn()} title="Confirm purchase">
        <button>Cancel</button>
        <button>Confirm</button>
      </Modal>
      <button>outside after</button>
    </>,
  );
}

describe("Modal — focus management", () => {
  it("moves focus into the dialog when it opens", () => {
    open();
    // The panel itself takes focus, so the next Tab lands on the first control inside.
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("keeps Tab inside the dialog, wrapping from the last control to the first", async () => {
    const user = userEvent.setup();
    open();

    await user.tab();
    expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();

    expect(screen.getByRole("button", { name: "outside after" })).not.toHaveFocus();
  });

  it("wraps backwards from the first control to the last", async () => {
    const user = userEvent.setup();
    open();

    await user.tab();
    expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
  });

  it("restores focus to the element that was focused before it opened", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [isOpen, setIsOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setIsOpen(true)}>Buy now</button>
          <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Confirm purchase">
            <button onClick={() => setIsOpen(false)}>Confirm</button>
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Buy now" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(trigger).toHaveFocus();
  });
});

describe("Modal — accessible name", () => {
  it("names the dialog from its heading without a hardcoded id", () => {
    render(
      <>
        <Modal isOpen onClose={vi.fn()} title="First dialog">
          <p>one</p>
        </Modal>
        <Modal isOpen onClose={vi.fn()} title="Second dialog">
          <p>two</p>
        </Modal>
      </>,
    );

    // Two modals mounted together used to emit duplicate id="modal-title", so the
    // second dialog's name resolved to the first one's heading.
    expect(screen.getByRole("dialog", { name: "First dialog" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Second dialog" })).toBeInTheDocument();
  });

  it("puts the dialog role on the panel, not the backdrop", () => {
    open();
    const dialog = screen.getByRole("dialog");
    // The overlay is a sibling of the panel, not a descendant of the dialog.
    expect(dialog.querySelector("[aria-hidden='true']")).toBeNull();
  });
});

describe("Modal — behaviour that already worked and must not regress", () => {
  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Confirm">
        <button>Confirm</button>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("releases the body scroll lock on unmount", () => {
    const { unmount } = open();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project component src/components/ui/Modal.component.test.tsx`

Expected: FAIL on every focus test — nothing focuses the dialog, Tab escapes to "outside after", and the two-modal name test fails on duplicate ids. The Escape and scroll-lock tests should PASS already; if they do not, stop and report, because those are supposed to work.

- [ ] **Step 3: Implement — the focusable selector**

At the top of `src/components/ui/Modal.tsx`, change the React import to `import { useEffect, useId, useRef } from "react";` and add above the types:

```tsx
/**
 * Everything inside the panel a user can Tab to.
 *
 * Deliberately not filtered by visibility: `offsetParent` is always null in jsdom, so a
 * visibility filter would behave differently under test than in a browser — and the
 * panel does not hide its own controls.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");
```

- [ ] **Step 4: Implement — the refs**

Replace `const dialogRef = useRef<HTMLDivElement>(null);` at `:29` with:

```tsx
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // A hardcoded id made two simultaneous modals emit duplicate ids, so the second
  // dialog's accessible name resolved to the first one's heading.
  const titleId = useId();
```

- [ ] **Step 5: Implement — trap Tab in the existing keydown effect**

Replace the Escape effect at `:32-39` with:

```tsx
  // Close on Escape, and keep Tab inside the panel while open.
  useEffect(() => {
    if (!isOpen) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );

      // A dialog with nothing focusable still must not leak focus to the page behind.
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        // The panel itself holds focus immediately after opening, so treat it as
        // "before the first item" when wrapping backwards.
        if (active === first || active === panel) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);
```

- [ ] **Step 6: Implement — take focus on open, give it back on close**

Add after the scroll-lock effect:

```tsx
  // Take focus on open; give it back on close.
  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      const previous = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // The trigger may have unmounted while the dialog was open.
      if (previous?.isConnected) previous.focus();
    };
  }, [isOpen]);
```

- [ ] **Step 7: Implement — move the dialog role onto the panel**

The outer div loses its ARIA and becomes a plain positioned container; the panel gains the role, `aria-modal`, the generated label id and `tabIndex={-1}`:

```tsx
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Semi-transparent overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={disableBackdropClose ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[
          "relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-xl",
          "flex flex-col max-h-[90vh] focus:outline-none",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
```

And the heading's `id="modal-title"` becomes `id={titleId}`.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- --project component src/components/ui/Modal.component.test.tsx`

Expected: PASS, all cases.

- [ ] **Step 9: Run every test that renders a Modal**

Run: `npm test -- --project component`

Expected: PASS. The buy flow, review flow and AI-description tests all mount modals; a focus change can break a query that assumed focus was elsewhere. If one fails, fix the test's assumption — do not weaken the trap.

- [ ] **Step 10: Deliberate break**

Delete the `event.preventDefault(); first.focus();` pair in the forward-wrap branch.

Run: `npm test -- --project component src/components/ui/Modal.component.test.tsx -t "wrapping from the last control"`

Expected: FAIL — focus escapes to "outside after". Restore and confirm PASS.

- [ ] **Step 11: Commit**

```bash
git add src/components/ui/Modal.tsx src/components/ui/Modal.component.test.tsx
git commit -m "fix(a11y): give Modal real focus management (C2, L4)"
```

Use a full message body describing: the vestigial `dialogRef`; that no initial focus, containment or restore existed; the two design-time defects (hardcoded label id, role on the backdrop); and that `inert` is deliberately omitted per spec D6.

---

### Task 5: The announcer — one shared pair of live regions — **CRITICAL**

Closes **C3**. Spec D7.

**Files:**
- Create: `src/components/ui/Announcer.tsx`, `src/components/ui/Announcer.component.test.tsx`
- Modify: `src/app/(frontend)/layout.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function AnnouncerProvider({ children }: { children: React.ReactNode })`
  - `export function useAnnounce(): (message: string, options?: { assertive?: boolean }) => void`

  Tasks 7, 8, 10 and 32 call `useAnnounce()`.

**Background.** Zero matches for `aria-live` or `role="status"` in the entire app. Every asynchronous change is silent: the results grid after a debounced search, the page counter, every loading state, the AI description landing in the textarea, the image-count error, the gallery swap. A screen reader user types a search term and receives no feedback at all — not even a results count.

**Why one shared pair rather than per-component `aria-live`:** a live region must be **in the DOM before its content changes**, or screen readers miss the update. A region that mounts at the same moment as the message it carries announces nothing. That is exactly the debounced-search case.

**Note:** `sr-only` is a built-in Tailwind v4 utility (`@import "tailwindcss"` at `globals.css:1`). Nothing needs adding to the stylesheet — the review's "no sr-only utility" was imprecise.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Announcer.component.test.tsx`:

```tsx
/**
 * The app had no live region anywhere, so every async change was silent to a screen
 * reader. react-hot-toast carries its own role="status", so order-placed and
 * review-submitted were announced; search, pagination and loading were not.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AnnouncerProvider, useAnnounce } from "./Announcer";

function Probe() {
  const announce = useAnnounce();
  return (
    <>
      <button onClick={() => announce("12 listings found")}>polite</button>
      <button onClick={() => announce("Upload failed", { assertive: true })}>
        assertive
      </button>
      <button onClick={() => announce("12 listings found")}>again</button>
    </>
  );
}

function setup() {
  return render(
    <AnnouncerProvider>
      <Probe />
    </AnnouncerProvider>,
  );
}

describe("Announcer", () => {
  it("mounts both regions before anything is announced", () => {
    setup();
    // A region that appears at the same moment as its message announces nothing.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("puts a polite message in the status region", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "polite" }));

    expect(screen.getByRole("status")).toHaveTextContent("12 listings found");
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });

  it("puts an assertive message in the alert region", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "assertive" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("re-announces an identical message", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "polite" }));
    const first = screen.getByRole("status").textContent;

    await userEvent.click(screen.getByRole("button", { name: "again" }));
    const second = screen.getByRole("status").textContent;

    // Identical text is not a DOM change, so a screen reader would stay silent on the
    // second search that happened to return the same count. The text must differ by
    // something inaudible.
    expect(second).not.toBe(first);
    expect(second).toContain("12 listings found");
  });

  it("keeps the regions visually hidden", () => {
    setup();
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(screen.getByRole("alert")).toHaveClass("sr-only");
  });
});

describe("useAnnounce outside a provider", () => {
  it("is a no-op rather than a crash", async () => {
    // A component rendered in isolation by a test must not explode.
    render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "polite" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project component src/components/ui/Announcer.component.test.tsx`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `src/components/ui/Announcer.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Announce = (message: string, options?: { assertive?: boolean }) => void;

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * `null` when no provider is mounted. `useAnnounce` degrades to a no-op rather than
 * throwing, so a component rendered in isolation by a test does not explode.
 */
const AnnouncerContext = createContext<Announce | null>(null);

const NOOP: Announce = () => {};

/**
 * The app's single pair of live regions.
 *
 * Mounted once, high in the tree, and never conditionally: a live region has to be in
 * the DOM *before* its content changes or screen readers miss the update entirely.
 * Per-component `aria-live` attributes fail exactly the debounced-search case that
 * motivates this — the region would appear at the same instant as its first message.
 */
export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  // Identical text is not a DOM change, so a repeated message would be silent. A
  // zero-width space alternates on each announcement to force one.
  const parity = useRef(false);

  const announce = useCallback<Announce>((message, options) => {
    parity.current = !parity.current;
    const text = parity.current ? `${message}\u200B` : message;
    if (options?.assertive) setAssertive(text);
    else setPolite(text);
  }, []);

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

/**
 * Announces a message to screen readers without changing anything on screen.
 *
 * ```tsx
 * const announce = useAnnounce();
 * announce(`${total} listings found`);
 * announce("Upload failed", { assertive: true });
 * ```
 *
 * Use `assertive` only for something the user must hear immediately — a failure that
 * interrupts what they were doing. Everything else is polite.
 */
export function useAnnounce(): Announce {
  return useContext(AnnouncerContext) ?? NOOP;
}
```

- [ ] **Step 4: Mount it in the layout**

In `src/app/(frontend)/layout.tsx`, import `AnnouncerProvider` and wrap the existing tree inside `AuthProvider`:

```tsx
import { AnnouncerProvider } from "@/components/ui/Announcer";

// ...

  return (
    <AuthProvider>
      <AnnouncerProvider>
        <div className="flex min-h-screen flex-col">
          <Navbar />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
            {children}
          </main>
          <Footer />
        </div>
      </AnnouncerProvider>
    </AuthProvider>
  );
```

The layout stays a server component — it still exports `metadata`. `AnnouncerProvider` is a client component imported into it, which is allowed.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- --project component src/components/ui/Announcer.component.test.tsx`

Expected: PASS.

- [ ] **Step 6: Deliberate break**

Delete the `parity` alternation — make `announce` set the bare `message`.

Run: `npm test -- --project component src/components/ui/Announcer.component.test.tsx -t "re-announces an identical message"`

Expected: FAIL — the second announcement produces identical text. Restore and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/Announcer.tsx src/components/ui/Announcer.component.test.tsx "src/app/(frontend)/layout.tsx"
git commit -m "feat(a11y): one shared pair of live regions (C3)"
```

Body should record: zero `aria-live` matches before this; what was silent; why one shared pair rather than per-component regions; the zero-width-space parity trick; and that `sr-only` is built into Tailwind v4.

---

### Task 6: `useFetch` — atomic state and an error-toast opt-out

Closes **M4**, **M8** and **L3**.

**Files:**
- Modify: `src/hooks/useFetch.ts`
- Test: `src/hooks/useFetch.component.test.tsx` (create)
- Modify: `src/components/listings/SimilarListings.tsx:23`, `src/components/RecommendedForYou.tsx:22`

**Interfaces:**
- Consumes: `ApiError` from Task 1 (only to preserve `err.message`; no branching here).
- Produces: `useFetch<T>(endpoint: string | null, options?: { onError?: "toast" | "silent" }): UseFetchResult<T>`.
  `UseFetchResult<T>` is unchanged: `{ data, setData, loading, error, refetch }`.

**Background — two findings in one hook.**

`loading` and `data` are independent state and `setLoading(true)` runs in a passive effect, i.e. *after* the browser paints. Click a card in "Similar listings" and the browser paints the **previous** listing's gallery, title, price and seller card at the new URL before the skeleton appears. The same one-frame lie happens on the order and profile pages, and on the browse grid the pager briefly enables Next/Previous against the old query's bounds.

Separately, both recommendation strips explicitly render `null` on error because "an error banner would compete with the page's actual content" — and then call this hook, which fires a toast anyway. The listing detail page runs three `useFetch` calls, so one network blip stacks three red toasts.

**The `deps` parameter is unused.** Verified: no call site passes a second argument. It exists only to justify an eslint-disable.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useFetch.component.test.tsx`:

```tsx
/**
 * Two findings in one hook.
 *
 * M4: `loading` and `data` were independent state and setLoading(true) ran in a passive
 * effect, so a render happened with the PREVIOUS endpoint's data and loading:false —
 * one painted frame of the wrong listing at the new URL.
 *
 * M8: every failure raised a toast, including for sections that document themselves as
 * silent on error.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";

import { useFetch } from "./useFetch";

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

let resolvers: Array<(value: unknown) => void>;

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(
      () => new Promise((resolve) => { resolvers.push(resolve); }),
    ),
  },
}));

beforeEach(() => {
  resolvers = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Probe({ endpoint, silent }: { endpoint: string; silent?: boolean }) {
  const { data, loading } = useFetch<{ title: string }>(
    endpoint,
    silent ? { onError: "silent" } : undefined,
  );
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="title">{data?.title ?? "none"}</span>
    </div>
  );
}

describe("useFetch — data and loading can never disagree", () => {
  it("never renders the previous endpoint's data with loading false", async () => {
    const { rerender } = render(<Probe endpoint="/api/listings/1" />);

    resolvers.shift()!({ title: "First listing" });
    await waitFor(() => expect(screen.getByTestId("title")).toHaveTextContent("First listing"));
    expect(screen.getByTestId("loading")).toHaveTextContent("false");

    // Switch endpoints. The stale frame this pins: data still "First listing" while
    // loading already reads false, at the URL of listing 2.
    rerender(<Probe endpoint="/api/listings/2" />);

    expect(screen.getByTestId("title")).toHaveTextContent("none");
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
  });
});

describe("useFetch — error reporting is opt-out", () => {
  it("toasts by default, as all eleven existing consumers expect", async () => {
    render(<Probe endpoint="/api/listings" />);
    resolvers.shift()!(Promise.reject(new Error("Network down")));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Network down"));
  });

  it("stays silent when the caller asks it to", async () => {
    render(<Probe endpoint="/api/recommendations" silent />);
    resolvers.shift()!(Promise.reject(new Error("Network down")));

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("useFetch — the race guard that already worked", () => {
  it("discards a response that arrives after the endpoint changed", async () => {
    const { rerender } = render(<Probe endpoint="/api/listings/1" />);
    const staleResolve = resolvers.shift()!;

    rerender(<Probe endpoint="/api/listings/2" />);
    const freshResolve = resolvers.shift()!;

    // The first request answers last — the classic search-as-you-type race.
    freshResolve({ title: "Second listing" });
    staleResolve({ title: "First listing" });

    await waitFor(() =>
      expect(screen.getByTestId("title")).toHaveTextContent("Second listing"),
    );
    expect(screen.getByTestId("title")).not.toHaveTextContent("First listing");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project component src/hooks/useFetch.component.test.tsx`

Expected: FAIL — the stale-frame test fails (data still reads "First listing"), and the silent test fails (`onError` is not a parameter; the second argument is treated as `deps`). The race-guard test should PASS already.

- [ ] **Step 3: Implement**

Rewrite `src/hooks/useFetch.ts`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UseFetchResult<T> = {
  /** The last successful response, or `null` before the first one arrives. */
  data: T | null;
  /** Lets a caller apply an optimistic update without a round trip. */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
  loading: boolean;
  error: string | null;
  /** Re-runs the request against the current endpoint. */
  refetch: () => void;
};

export type UseFetchOptions = {
  /**
   * How a failure is reported. `"toast"` is the default because eleven consumers
   * rely on it; `"silent"` is for sections that render `null` on error and would
   * otherwise raise a toast about something the user cannot see.
   */
  onError?: "toast" | "silent";
};

/**
 * One state object rather than three `useState` calls.
 *
 * `data` and `loading` used to move independently, and `setLoading(true)` ran in a
 * passive effect — after paint. That produced one rendered frame carrying the previous
 * endpoint's data with `loading: false`, at the new URL.
 */
type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

const INITIAL: FetchState<never> = { data: null, loading: true, error: null };

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `GET`s an endpoint and tracks the request's data/loading/error state.
 *
 * ```tsx
 * const { data: orders, loading, error } = useFetch<Order[]>("/api/orders");
 * ```
 *
 * Pass `null` as the endpoint when the request is not ready yet — for example while
 * waiting for the authenticated user — and `loading` stays `true` until a real
 * endpoint arrives:
 *
 * ```tsx
 * const { data } = useFetch<ListingsResponse>(
 *   user ? `/api/listings?sellerId=${user.id}` : null
 * );
 * ```
 *
 * A response that arrives after the endpoint changed (or after unmount) is discarded.
 * Failures set `error` and, unless `onError: "silent"`, raise a toast.
 */
export function useFetch<T>(
  endpoint: string | null,
  options: UseFetchOptions = {},
): UseFetchResult<T> {
  const { onError = "toast" } = options;

  const [state, setState] = useState<FetchState<T>>(INITIAL);
  const [reloadCount, setReloadCount] = useState(0);
  const [lastEndpoint, setLastEndpoint] = useState(endpoint);

  // Reset during render, not in an effect. An effect runs after paint, which is what
  // produced the stale frame; adjusting state while rendering means the browser never
  // sees the previous endpoint's data under the new one.
  if (endpoint !== lastEndpoint) {
    setLastEndpoint(endpoint);
    setState(INITIAL);
  }

  const refetch = useCallback(() => setReloadCount((count) => count + 1), []);

  const setData = useCallback<React.Dispatch<React.SetStateAction<T | null>>>(
    (update) => {
      setState((prev) => ({
        ...prev,
        data:
          typeof update === "function"
            ? (update as (previous: T | null) => T | null)(prev.data)
            : update,
      }));
    },
    [],
  );

  useEffect(() => {
    if (endpoint === null) return;

    let alive = true;

    async function load() {
      try {
        const result = await api.get<T>(endpoint as string);
        if (!alive) return;
        setState({ data: result, loading: false, error: null });
      } catch (err: unknown) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Failed to load";
        setState({ data: null, loading: false, error: message });
        if (onError === "toast") toast.error(message);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [endpoint, reloadCount, onError]);

  return { ...state, setData, refetch };
}
```

Note what changed and why:
- `setLoading(true)` at the start of `load()` is **gone** — the render-time reset already put `loading: true` in place before paint.
- The `finally` block is gone; each terminal branch writes the whole state atomically.
- `deps` and its `eslint-disable-next-line` are gone, so the effect's dependency array is now statically checkable.
- The `alive` guard is unchanged. Do not touch it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --project component src/hooks/useFetch.component.test.tsx`

Expected: PASS, all four cases.

- [ ] **Step 5: Adopt the opt-out at the two silent sections**

`src/components/listings/SimilarListings.tsx:23` and `src/components/RecommendedForYou.tsx:22` both render `null` on error by design. Add the option:

```tsx
const { data } = useFetch<SimilarListing[]>(
  /* existing endpoint expression */,
  { onError: "silent" },
);
```

Keep the existing comment explaining why the section is silent, and extend it to say the hook now honours that rather than contradicting it.

- [ ] **Step 6: Confirm nothing else passed a second argument**

Run: `grep -rn "useFetch<" src --include=*.tsx | grep -v "\.test\."`

Expected: the 14 call sites, of which exactly two now pass `{ onError: "silent" }` and the rest pass only an endpoint. If any other site passes an array, it was relying on `deps` — stop and report.

- [ ] **Step 7: Run the full component project**

Run: `npm test -- --project component`

Expected: PASS. Eleven consumers changed behaviour on endpoint switch; a test asserting stale content during a transition would now correctly fail.

- [ ] **Step 8: Deliberate break — the stale frame**

Move the reset out of render and back into an effect:

```tsx
useEffect(() => { setState(INITIAL); }, [endpoint]);
```

Run: `npm test -- --project component src/hooks/useFetch.component.test.tsx -t "previous endpoint's data"`

Expected: FAIL. Restore and confirm PASS.

- [ ] **Step 9: Deliberate break — the race guard (global constraint 6)**

Delete `if (!alive) return;` from the success branch.

Run: `npm test -- --project component src/hooks/useFetch.component.test.tsx -t "arrives after the endpoint changed"`

Expected: FAIL — the stale response overwrites the fresh one. Restore and confirm PASS.

This is the regression guard required by spec §7.5. Record both breaks in your report.

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useFetch.ts src/hooks/useFetch.component.test.tsx src/components/listings/SimilarListings.tsx src/components/RecommendedForYou.tsx
git commit -m "fix(fe): make useFetch state atomic and its error toast opt-out (M4, M8, L3)"
```

Body should record: the one-frame stale render and why a render-time reset fixes it where an effect cannot; the two sections that documented themselves as silent and then toasted anyway; the removal of the unused `deps` parameter and its eslint-disable; and that the `alive` race guard is unchanged and covered by its own deliberate break.

---

## Wave 1 gate

Before starting wave 2, the controller runs, backgrounded:

```bash
npm test
npm run build
npx tsc --noEmit
npm run lint
```

Expected: full suite green (baseline 1703 passed / 8 skipped / 0 failed, plus the new tests), build succeeds with all 28 routes, `tsc` clean, lint 0 errors 0 warnings.

---

# Wave 2 — Consumers of the primitives

Each of the 19 Button files and 11 `useFetch` files is opened once here, with the primitives settled.

---

### Task 7: Refetch the listing after a purchase, and branch on 409

Closes **H5**.

**Files:**
- Modify: `src/app/(frontend)/listings/[id]/page.tsx` (`:36-40`, `:57`, `:76-89`, `:151-156`)
- Test: `src/app/(frontend)/listings/[id]/page.component.test.tsx` (exists — append)

**Interfaces:**
- Consumes: `ApiError` (Task 1), `useAnnounce` (Task 5), `formatPrice` (Task 3).
- Produces: nothing other tasks depend on.

**Background.** The listing is never refetched after ordering, so `isForSale` at `:57` keeps reading a status fetched *before* the mutation. The green "Order placed successfully" banner appears **above a still-live Buy Now button**; clicking it answers with "This listing already has an order in progress". On a lost race the page says `active` forever and retrying reproduces the same 409 indefinitely, with nothing on screen suggesting a reload.

The API's error prose is good here. The problem is entirely what the client does next.

- [ ] **Step 1: Write the failing test**

Append to the page's existing component test file, reusing its render helper and mock setup:

```tsx
describe("H5 — the page reflects the purchase that just happened", () => {
  it("stops offering Buy Now once the order is placed", async () => {
    const user = userEvent.setup();
    // First load: active. After the POST, the refetch answers `reserved`.
    mockListing({ status: "active" });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Buy Now" }));
    mockListing({ status: "reserved" });
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Buy Now" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "View order" })).toBeInTheDocument();
  });

  it("tells the user to reload when someone else won the race", async () => {
    const user = userEvent.setup();
    mockListing({ status: "active" });
    mockOrderFailure(409, "This listing has just been reserved by another buyer");
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Buy Now" }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    // The server's prose reaches the user intact, and the page offers a way forward
    // rather than leaving them to press a button that can only 409 again.
    expect(
      await screen.findByText(/has just been reserved by another buyer/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh listing/i })).toBeInTheDocument();
  });

  it("does not offer a refresh action for an ordinary failure", async () => {
    const user = userEvent.setup();
    mockListing({ status: "active" });
    mockOrderFailure(500, "Something went wrong");
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Buy Now" }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh listing/i })).toBeNull();
  });
});
```

Add `mockOrderFailure(status, message)` to the file's existing helpers — it must reject `api.post` with an `ApiError` carrying that status, since the branch under test reads `err.status`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project component "src/app/(frontend)/listings/[id]/page.component.test.tsx"`

Expected: FAIL — Buy Now is still offered after the order, and no refresh action exists.

- [ ] **Step 3: Implement**

Destructure `refetch` from the listing fetch at `:36-40`:

```tsx
  const {
    data: listing,
    loading,
    error: loadError,
    refetch: refetchListing,
  } = useFetch<ListingDetail>(hasValidId ? `/api/listings/${listingId}` : null);
```

Add state for the stale-page case and the announcer, near `:47`:

```tsx
  // Set when the server tells us the world changed underneath this page. The Buy
  // button cannot succeed again until the listing is refetched, so say so.
  const [isStale, setIsStale] = useState(false);
  const announce = useAnnounce();
```

Rewrite `handleBuyNow`'s try/catch:

```tsx
    try {
      const order = await api.post<CreatedOrder>("/api/orders", { listingId });

      setOrderSuccessId(order.id);
      setIsBuyModalOpen(false);
      setIsStale(false);
      toast.success(`Order #${order.id} placed successfully!`);
      announce(`Order ${order.id} placed successfully`);

      // The status this page is rendering was fetched before the mutation. Without
      // this the success banner sits above a still-live Buy Now button.
      refetchListing();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create order";
      setActionError(msg);
      toast.error(msg);
      announce(msg, { assertive: true });

      // 409 means the world changed, not that the request was malformed. Retrying the
      // same click can only produce the same answer; only a reload can help.
      if (err instanceof ApiError && err.status === 409) {
        setIsStale(true);
        setIsBuyModalOpen(false);
      }
    } finally {
      setBuying(false);
    }
```

Gate the Buy button and add the recovery action at `:151-156`:

```tsx
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {isForSale && !isStale ? (
              <Button onClick={() => setIsBuyModalOpen(true)}>Buy Now</Button>
            ) : (
              <StatusBadge status={listing.status} kind="listing" size="md" />
            )}
            {isStale && (
              <Button
                variant="secondary"
                onClick={() => {
                  setIsStale(false);
                  setActionError(null);
                  refetchListing();
                }}
              >
                Refresh listing
              </Button>
            )}
            {orderSuccessId && (
              <Button
                variant="secondary"
                onClick={() => router.push(`/orders/${orderSuccessId}`)}
              >
                View order
              </Button>
            )}
          </div>
```

Add the imports: `ApiError` from `@/lib/api`, `useAnnounce` from `@/components/ui/Announcer`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --project component "src/app/(frontend)/listings/[id]/page.component.test.tsx"`

Expected: PASS.

- [ ] **Step 5: Deliberate break**

Delete the `refetchListing()` call from the success branch.

Run: `npm test -- --project component "src/app/(frontend)/listings/[id]/page.component.test.tsx" -t "stops offering Buy Now"`

Expected: FAIL — Buy Now is still rendered. Restore and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(frontend)/listings/[id]/page.tsx" "src/app/(frontend)/listings/[id]/page.component.test.tsx"
git commit -m "fix(fe): refetch the listing after a purchase and branch on 409 (H5)"
```

Body: the success banner sat above a live Buy Now button because `isForSale` read a pre-mutation status; a lost race left the page saying `active` forever with no hint to reload. 409 now yields an explicit "Refresh listing" action rather than a button that can only fail the same way again.

---

### Task 8: Browse state — reset the page on search, debounce prices, drop the decorative button

Closes **H6** and **M3**.

**Files:**
- Modify: `src/app/(frontend)/listings/page.tsx` (`:65-87`, `:94-97`, `:126`, `:163-181`, `:206`)
- Test: `src/app/(frontend)/listings/page.component.test.tsx` (exists — append)

**Interfaces:**
- Consumes: `useAnnounce` (Task 5), `useDebouncedValue` (existing).
- Produces: nothing.

**Background — H6.** Search is the one filter that does not reset pagination. Sort (`:195`), category (`:158`) and the smart-search toggle (`:142`) all call `setPage(1)`. Search does not, and it feeds the query through a debounce that bypasses the submit handler entirely. Browse to page 4, type a word, and you get the empty state under a pager reading "Page 4 of 1". The user concludes the marketplace has nothing.

**Background — M3.** The min/max price fields sit in the same query memo with no debounce, so typing `1000` fires four API requests, four `router.replace` navigations, and flips the grid to skeletons four times. Search is debounced with a stated reason; these were missed.

**Background — the Apply button.** `handleFiltersSubmit` only calls `setPage(1)`. It reads as "your filters are pending" — which is false, they apply live — while being the one thing that fixed the pagination bug. Once search resets the page itself, the button does nothing at all. Remove it. The form keeps its `onSubmit` handler so pressing Enter in the search field does not reload the page.

- [ ] **Step 1: Write the failing test**

Append to `src/app/(frontend)/listings/page.component.test.tsx`:

```tsx
describe("H6 — searching resets pagination", () => {
  it("returns to page 1 when the search term changes", async () => {
    const user = userEvent.setup();
    renderPage();

    // Go to page 2, then search. The bug: the query kept page=2 against a result set
    // with one page, so the grid was empty under a pager reading "Page 2 of 1".
    await user.click(await screen.findByRole("button", { name: /next/i }));
    await waitFor(() => expect(lastQuery()).toContain("page=2"));

    await user.type(screen.getByLabelText(/search/i), "jacket");

    await waitFor(() => expect(lastQuery()).toContain("search=jacket"));
    expect(lastQuery()).toContain("page=1");
  });
});

describe("M3 — price filters are debounced", () => {
  it("issues one request for a four-keystroke price, not four", async () => {
    const user = userEvent.setup();
    renderPage();
    const before = requestCount();

    await user.type(screen.getByLabelText(/min price/i), "1000");

    // Each keystroke used to produce a request, a router.replace and a skeleton flash.
    await waitFor(() => expect(lastQuery()).toContain("minPrice=1000"));
    expect(requestCount() - before).toBeLessThanOrEqual(2);
  });
});

describe("M3 — the decorative submit button is gone", () => {
  it("offers no Apply filters button, because filters apply live", async () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /apply filters/i })).toBeNull();
    expect(await screen.findByRole("button", { name: /clear/i })).toBeInTheDocument();
  });
});

describe("C3 — results are announced", () => {
  it("announces the result count after a search settles", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/search/i), "jacket");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/\d+ listings? found/),
    );
  });
});
```

The file needs `lastQuery()` and `requestCount()` helpers reading the mocked `api.get` calls, and `renderPage` must wrap in `AnnouncerProvider` for the last block. Add them alongside the file's existing helpers.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project component "src/app/(frontend)/listings/page.component.test.tsx"`

Expected: FAIL on all four — the page stays at 2, four requests fire, the Apply button exists, nothing is announced.

- [ ] **Step 3: Implement — reset the page on search**

At `:126`:

```tsx
            onChange={(event) => {
              setSearch(event.target.value);
              // Every sibling control does this. Search did not, and it is the one
              // that feeds a debounce, so a stale page number outlived the query.
              setPage(1);
            }}
```

- [ ] **Step 4: Implement — debounce the price fields**

Beside the existing search debounce at `:63`:

```tsx
  // Same reasoning as the search debounce: typing "1000" is four keystrokes, and each
  // one otherwise costs a request, a router.replace and a flip to skeletons.
  const debouncedMinPrice = useDebouncedValue(minPrice, 400);
  const debouncedMaxPrice = useDebouncedValue(maxPrice, 400);
```

In the `query` memo, replace `minPrice` / `maxPrice` with the debounced values in both the body and the dependency array:

```tsx
    if (debouncedMinPrice) params.set("minPrice", debouncedMinPrice);
    if (debouncedMaxPrice) params.set("maxPrice", debouncedMaxPrice);
```

```tsx
  }, [page, debouncedSearch, categoryId, debouncedMinPrice, debouncedMaxPrice, sort, smartSearch]);
```

Then reset the page from the price inputs too, matching every other control:

```tsx
            onChange={(event) => {
              setMinPrice(event.target.value);
              setPage(1);
            }}
```

…and the same for `maxPrice`.

- [ ] **Step 5: Implement — remove the decorative button**

Replace the button row at `:206`:

```tsx
          <div className="flex items-end gap-2 md:col-span-2 lg:col-span-6">
            <Button type="button" variant="secondary" onClick={clearFilters}>
              Clear
            </Button>
          </div>
```

Keep `handleFiltersSubmit` but reduce it to its only remaining job, and say why:

```tsx
  // Filters apply as they change; there is nothing to submit. This exists so pressing
  // Enter in the search field does not reload the page.
  function handleFiltersSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }
```

- [ ] **Step 6: Implement — announce the results**

Add `const announce = useAnnounce();` and an effect after the fetch:

```tsx
  // A screen reader user types a search term and the page silently replaces its
  // contents. Announce the count once the request settles.
  useEffect(() => {
    if (loading || !data) return;
    const total = data.total ?? listings.length;
    announce(`${total} ${total === 1 ? "listing" : "listings"} found`);
  }, [loading, data, listings.length, announce]);
```

If `ListingsResponse` has no `total` field, use `listings.length` alone and drop the `??`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- --project component "src/app/(frontend)/listings/page.component.test.tsx"`

Expected: PASS.

- [ ] **Step 8: Deliberate break**

Remove the `setPage(1)` you added to the search `onChange`.

Run: `npm test -- --project component "src/app/(frontend)/listings/page.component.test.tsx" -t "returns to page 1"`

Expected: FAIL — the query still carries `page=2`. Restore and confirm PASS.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(frontend)/listings/page.tsx" "src/app/(frontend)/listings/page.component.test.tsx"
git commit -m "fix(fe): reset pagination on search, debounce price filters (H6, M3)"
```

Body: search was the one filter not resetting the page, producing an empty grid under a pager reading "Page 4 of 1" on a perfectly valid search; price fields fired a request per keystroke; and "Apply filters" only ever called setPage(1), reading as "filters pending" when they were already live — now removed, with the submit handler kept only so Enter does not reload.

---

### Task 9: Confirm the two terminal order transitions

Closes **H4**.

**Files:**
- Modify: `src/components/orders/OrderActions.tsx`
- Test: `src/components/orders/OrderActions.component.test.tsx` (exists — append)

**Interfaces:**
- Consumes: `Modal` (Task 4).
- Produces: `OrderActionsProps` unchanged. `onTransition` is now called only after confirmation for destructive transitions.

**Background.** "Decline order" and "Cancel order" both land in terminal states with no path back, and both are plain buttons inside a dense grid of order cards. A seller scrolling their dashboard on a phone can brush the wrong card and permanently kill a sale.

The codebase confirms *lesser* actions: buying uses a `Modal`, replacing an AI description uses a `Modal`, deleting a listing uses `window.confirm`. The two destructive ones are the exceptions. Use `Modal`, matching the buy and review flows rather than `window.confirm`.

`ACTIONS` at `:26-37` is the single source of wording, and the existing test asserts the **exact array** of offered transitions — do not disturb that ordering.

- [ ] **Step 1: Write the failing test**

Append to `src/components/orders/OrderActions.component.test.tsx`:

```tsx
describe("H4 — terminal transitions ask first", () => {
  it("does not decline on the first click", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="seller" onTransition={onTransition} />);

    await user.click(screen.getByRole("button", { name: "Decline order" }));

    expect(onTransition).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /decline this order/i })).toBeInTheDocument();
  });

  it("declines once confirmed in the dialog", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="seller" onTransition={onTransition} />);

    await user.click(screen.getByRole("button", { name: "Decline order" }));
    await user.click(screen.getByRole("button", { name: "Decline order", hidden: false }));

    expect(onTransition).toHaveBeenCalledWith("declined");
  });

  it("abandons the transition when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="buyer" onTransition={onTransition} />);

    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    await user.keyboard("{Escape}");

    expect(onTransition).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still fires non-destructive transitions on one click", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="seller" onTransition={onTransition} />);

    await user.click(screen.getByRole("button", { name: "Confirm order" }));

    expect(onTransition).toHaveBeenCalledWith("confirmed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

In the second case the dialog's confirm button and the trigger share a label; disambiguate with `within(screen.getByRole("dialog")).getByRole("button", { name: "Decline order" })` if the query is ambiguous.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --project component src/components/orders/OrderActions.component.test.tsx`

Expected: FAIL — the first click already calls `onTransition` and no dialog exists.

- [ ] **Step 3: Implement**

Add the destructive set and the confirmation copy beside `ACTIONS`:

```tsx
/**
 * Transitions with no path back.
 *
 * The codebase already confirms lesser actions — buying and replacing an AI
 * description both use a Modal, deleting a listing uses window.confirm. These two were
 * the exceptions, and they are plain buttons in a dense grid of order cards.
 */
const DESTRUCTIVE: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  declined: {
    title: "Decline this order?",
    body: "The buyer will be told the order was declined. This cannot be undone.",
  },
  cancelled: {
    title: "Cancel this order?",
    body: "The order will be cancelled and the listing released. This cannot be undone.",
  },
};
```

Then in the component:

```tsx
  const [pending, setPending] = useState<OrderStatus | null>(null);
  const confirmation = pending ? DESTRUCTIVE[pending] : undefined;

  function handleClick(to: OrderStatus) {
    if (DESTRUCTIVE[to]) {
      setPending(to);
      return;
    }
    onTransition(to);
  }
```

Change the button's handler to `onClick={() => handleClick(action.to)}` and render the dialog after the button row:

```tsx
      {pending && confirmation && (
        <Modal
          isOpen
          onClose={() => setPending(null)}
          title={confirmation.title}
        >
          <p className="text-sm text-zinc-600">{confirmation.body}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep order
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const to = pending;
                setPending(null);
                onTransition(to);
              }}
            >
              {ACTIONS.find((action) => action.to === pending)?.label}
            </Button>
          </div>
        </Modal>
      )}
```

Wrap the existing `<div className="flex flex-wrap gap-2">` and the dialog in a fragment. Import `useState` from react and `Modal` from `@/components/ui`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --project component src/components/orders/OrderActions.component.test.tsx`

Expected: PASS — including the pre-existing exact-array assertion, which must be untouched.

- [ ] **Step 5: Deliberate break**

Remove `cancelled` from `DESTRUCTIVE`.

Run: `npm test -- --project component src/components/orders/OrderActions.component.test.tsx -t "abandons the transition"`

Expected: FAIL — the cancel fires immediately with no dialog to dismiss. Restore and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/orders/OrderActions.tsx src/components/orders/OrderActions.component.test.tsx
git commit -m "fix(ux): confirm the two terminal order transitions (H4)"
```

Body: Decline and Cancel both land in terminal states with no path back and were plain buttons in a dense grid of cards — a seller on a phone could brush the wrong card and permanently kill a sale. The app already confirms lesser actions; these were the exceptions. Uses Modal to match the buy and review flows.

---

### Task 10: The upload path — validate first, stop stranding drafts, confirm photo deletes

Closes **H3**, **H2** and **M7**. The highest-value task in the wave.

**Files:**
- Modify: `src/components/listings/ImageUploader.tsx` (`:48-60`, `:78-80`)
- Modify: `src/components/listings/ListingForm.tsx` (`:101-109`, `:162-177`)
- Modify: `src/components/seller/SellerListingCard.tsx:44`, `src/components/seller/SellerListingsTab.tsx:122`
- Test: `src/components/listings/ImageUploader.component.test.tsx`, `src/components/listings/ListingForm.component.test.tsx` (both exist — append)

**Interfaces:**
- Consumes: `Modal` (Task 4), `useAnnounce` (Task 5).
- Produces: `export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;` and `export const ACCEPTED_IMAGE_TYPES` from `ImageUploader.tsx`.

**Background — H3.** `file.size` is never consulted and the type is guarded only by the `accept` attribute, which any file picker overrides. The UI promises 5 MB at `:78-80`. The oversized file gets a thumbnail like every valid one; the rejection arrives after the user has finished the form and waited through the upload. On a phone connection that is a minute of someone's life and their data allowance. The review calls this the cheapest high-value fix in the whole audit.

**Background — H2.** Creation is draft → upload → publish. `uploadFiles` is sequential and throws on the first rejection, so a failure on photo three aborts the publish and leaves the draft behind. `created.id` is a `const` **inside the try block**, so pressing "Create listing" again creates a *second* draft and re-uploads the first two photos into it. The code comment claims the seller "can finish or delete it from their dashboard" — but `SellerListingCard.tsx:44` sets `canDelete={user?.role === "admin"}` and the activate toggle excludes `draft`. Neither half of that promise is true.

**Background — M7.** `handleRemoveExisting` issues the DELETE straight away from a 12-pixel × on the thumbnail corner. Pressing Cancel on the form does not bring the photo back, because the deletion was never part of the form.

- [ ] **Step 1: Write the failing ImageUploader test**

Append to `src/components/listings/ImageUploader.component.test.tsx`:

```tsx
describe("H3 — files are validated before they are accepted", () => {
  function oversize() {
    const file = new File(["x"], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 6 * 1024 * 1024 });
    return file;
  }

  it("rejects a file over 5 MB and names it", async () => {
    const onFilesChange = vi.fn();
    render(<ImageUploader files={[]} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText(/photos/i), oversize());

    // The UI promises "5 MB each" three lines below the input. It has to mean it.
    expect(await screen.findByText(/huge\.jpg is larger than 5 MB/i)).toBeInTheDocument();
    expect(onFilesChange).not.toHaveBeenCalled();
  });

  it("rejects a type the server will not store, whatever the picker allowed", async () => {
    const onFilesChange = vi.fn();
    render(<ImageUploader files={[]} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />);

    const pdf = new File(["x"], "invoice.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/photos/i), pdf);

    expect(await screen.findByText(/invoice\.pdf is not a JPEG, PNG or WebP/i)).toBeInTheDocument();
    expect(onFilesChange).not.toHaveBeenCalled();
  });

  it("accepts the valid files from a mixed selection and reports only the rejects", async () => {
    const onFilesChange = vi.fn();
    render(<ImageUploader files={[]} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />);

    const good = new File(["x"], "ok.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/photos/i), [good, oversize()]);

    expect(onFilesChange).toHaveBeenCalledWith([good]);
    expect(await screen.findByText(/huge\.jpg is larger than 5 MB/i)).toBeInTheDocument();
  });
});

describe("L23 — two files with the same name and size", () => {
  it("renders both without a duplicate React key", async () => {
    const onFilesChange = vi.fn();
    const a = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    const b = new File(["x"], "photo.jpg", { type: "image/jpeg" });

    render(<ImageUploader files={[a, b]} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />);

    expect(screen.getAllByAltText("photo.jpg")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --project component src/components/listings/ImageUploader.component.test.tsx`

Expected: FAIL — oversized and wrong-type files are accepted silently.

- [ ] **Step 3: Implement the ImageUploader validation**

Add near the top of `src/components/listings/ImageUploader.tsx`:

```tsx
/** Matches the server's limit. The UI promises this in the help text below the input. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Matches the `accept` attribute, which a file picker can override. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

function rejectionFor(file: File): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name} is not a JPEG, PNG or WebP.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name} is larger than 5 MB.`;
  }
  return null;
}
```

Replace the `tooMany` boolean with a message list, and rewrite `handleSelect`:

```tsx
  const [problems, setProblems] = useState<string[]>([]);

  function handleSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;

    // Validate before accepting anything. Previously the only check was the server's,
    // which arrives after the seller has finished the form and waited through the
    // upload — and then leaves a draft behind.
    const accepted: File[] = [];
    const rejected: string[] = [];

    for (const file of picked) {
      const problem = rejectionFor(file);
      if (problem) rejected.push(problem);
      else accepted.push(file);
    }

    if (total + accepted.length > MAX_IMAGES) {
      setProblems([`You can attach at most ${MAX_IMAGES} photos to a listing.`]);
      return;
    }

    setProblems(rejected);
    if (accepted.length > 0) onFilesChange([...files, ...accepted]);
  }
```

Render the messages in place of the old `tooMany` paragraph, in a region the announcer covers:

```tsx
      {problems.length > 0 && (
        <ul className="text-xs text-red-600">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
```

Finally fix the duplicate-key hazard at the preview `<li>`: `key={`pending-${file.name}-${file.size}`}` collides for two identically-sized files of the same name. The `previews` memo already pairs each file with a unique object URL — key on that instead: `key={url}`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- --project component src/components/listings/ImageUploader.component.test.tsx`

Expected: PASS.

- [ ] **Step 5: Write the failing ListingForm test**

Append to `src/components/listings/ListingForm.component.test.tsx`:

```tsx
describe("H2 — a failed upload does not strand or duplicate a draft", () => {
  it("reuses the same draft when the seller retries", async () => {
    const user = userEvent.setup();
    mockCreateListing({ id: 42 });
    mockUploadFailure("Could not upload photo-3.jpg");

    renderCreateForm();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create listing/i }));
    await screen.findByText(/could not upload photo-3\.jpg/i);

    // The retry must not create a second draft. created.id used to be a const inside
    // the try block, so it was lost the moment the upload threw.
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    expect(createListingCalls()).toHaveLength(1);
  });

  it("tells the seller the draft is waiting for them", async () => {
    const user = userEvent.setup();
    mockCreateListing({ id: 42 });
    mockUploadFailure("Could not upload photo-3.jpg");

    renderCreateForm();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    expect(await screen.findByText(/saved as a draft/i)).toBeInTheDocument();
  });
});

describe("M7 — deleting a saved photo asks first", () => {
  it("does not issue the DELETE until confirmed", async () => {
    const user = userEvent.setup();
    renderEditForm({ images: [{ id: 9 }] });

    await user.click(await screen.findByRole("button", { name: /remove image 9/i }));

    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: /remove this photo/i })).toBeInTheDocument();

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /remove photo/i }));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- --project component src/components/listings/ListingForm.component.test.tsx`

Expected: FAIL — a second draft is created, no draft notice appears, and the DELETE fires immediately.

- [ ] **Step 7: Implement — keep the draft id across a retry**

In `ListingForm.tsx`, hoist the draft id out of the submit handler:

```tsx
  /**
   * The draft created by a previous, failed submit.
   *
   * `created.id` used to be a const inside the try block, so a failure during upload
   * lost it — and the retry created a second draft, re-uploading the photos that had
   * already succeeded into it. The orphan sat in the dashboard with no available
   * action, because drafts could be neither activated nor deleted by their seller.
   */
  const [draftId, setDraftId] = useState<number | null>(null);
```

Rewrite the create branch of `handleSubmit`:

```tsx
      } else {
        const listingId =
          draftId ??
          (
            await api.post<CreatedListing>("/api/listings", {
              ...payload,
              status: "draft",
            })
          ).id;

        setDraftId(listingId);

        await uploadFiles(listingId);

        await api.patch(`/api/listings/${listingId}`, { status: "active" });

        setDraftId(null);
        toast.success("Listing created successfully!");
        router.push(`/listings/${listingId}`);
      }
```

A retry after an upload failure now reuses the draft. If the *first* photo already uploaded, it is still attached — that is the intended behaviour, not a duplicate.

- [ ] **Step 8: Implement — say where the draft went**

In the catch block, when `draftId` is set, extend the message rather than replacing it:

```tsx
      const msg = /* existing message derivation */;
      setSubmitError(
        draftId
          ? `${msg} Your listing was saved as a draft — press Create listing again to finish it, or delete it from your dashboard.`
          : msg,
      );
```

- [ ] **Step 9: Implement — make that promise true**

`SellerListingCard.tsx:44` currently reads `canDelete={user?.role === "admin"}`. A seller must be able to delete their own draft:

```tsx
        canDelete={user?.role === "admin" || listing.status === "draft"}
```

And in `SellerListingsTab.tsx:122`, the activate toggle deliberately excludes `draft`. Leave that alone — publishing a draft belongs to the form, which is where the photos are. Deleting is the escape hatch the comment promised.

- [ ] **Step 10: Implement — confirm the photo delete**

Replace the immediate delete in `handleRemoveExisting` with a pending-id state and a `Modal`, mirroring Task 9's shape:

```tsx
  const [photoPendingRemoval, setPhotoPendingRemoval] = useState<number | null>(null);

  async function confirmRemoveExisting() {
    const imageId = photoPendingRemoval;
    setPhotoPendingRemoval(null);
    if (imageId === null || props.mode !== "edit") return;
    try {
      await api.delete(`/api/listings/${props.listingId}/images/${imageId}`);
      setExistingImages((current) => current.filter((image) => image.id !== imageId));
      announce("Photo removed");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not remove that photo");
    }
  }
```

Pass `onRemoveExisting={setPhotoPendingRemoval}` to `ImageUploader`, and render the dialog:

```tsx
      {photoPendingRemoval !== null && (
        <Modal isOpen onClose={() => setPhotoPendingRemoval(null)} title="Remove this photo?">
          <p className="text-sm text-zinc-600">
            The photo is deleted straight away. Cancelling the form afterwards will not
            bring it back.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPhotoPendingRemoval(null)}>
              Keep photo
            </Button>
            <Button variant="danger" onClick={confirmRemoveExisting}>
              Remove photo
            </Button>
          </div>
        </Modal>
      )}
```

The dialog copy states the thing the UI previously hid: the deletion is not part of the form.

- [ ] **Step 11: Run both test files**

Run: `npm test -- --project component src/components/listings/ImageUploader.component.test.tsx src/components/listings/ListingForm.component.test.tsx`

Expected: PASS.

- [ ] **Step 12: Deliberate break ×2**

(a) Delete the `file.size > MAX_IMAGE_BYTES` branch in `rejectionFor`.
Run: `npm test -- --project component src/components/listings/ImageUploader.component.test.tsx -t "larger than 5 MB"` → FAIL. Restore.

(b) Change `draftId ?? (await api.post…)` back to always posting.
Run: `npm test -- --project component src/components/listings/ListingForm.component.test.tsx -t "reuses the same draft"` → FAIL. Restore.

Confirm both PASS again.

- [ ] **Step 13: Commit**

```bash
git add src/components/listings src/components/seller
git commit -m "fix(fe): validate uploads client-side and stop stranding drafts (H3, H2, M7, L23)"
```

Body: `file.size` was never consulted and the type was guarded only by `accept`, which any picker overrides, so the rejection arrived after the seller finished the form and waited through the upload; `created.id` lived inside the try block, so a retry made a second draft; the comment promising the seller could "finish or delete it from their dashboard" was false in both halves; and the 12-pixel × issued a DELETE with no confirmation and no way back.

---

### Task 11: Keep the destination through sign-in, and stop anonymous loads burning refresh attempts

Closes **M5** and **M2**.

**Files:**
- Modify: `src/components/ProtectedRoute.tsx:71-75`, `src/app/(frontend)/login/page.tsx:31,68-70`
- Modify: `src/lib/api.ts:23` (the `NO_REFRESH` list)
- Modify: `src/app/api/auth/refresh/route.ts` (order of the rate-limit and no-cookie checks)
- Test: `src/components/ProtectedRoute.component.test.tsx` (created in Task 26 — create it here if it does not exist yet), `src/lib/api.test.ts`, `src/app/api/rate-limits.integration.test.ts`

**Interfaces:**
- Consumes: `safeReturnTo` from `@/lib/oauth/return-to` (existing).
- Produces: nothing.

**Background — M5.** `ProtectedRoute` redirects with no `returnTo`. The login page *reads* `returnTo` at `:31`, forwards it to the OAuth buttons, and then ignores it on the password path at `:68-70`, which hardcodes `router.push("/")`. Open a shared link to `/orders/412`, sign in, land on the marketing home page — and the link is gone from history because the redirect used `replace`. `safeReturnTo` already exists to sanitise the value.

**Background — M2.** `/api/auth/me` is not in `NO_REFRESH`, so the bootstrap 401 every anonymous visitor receives triggers a refresh POST — and the route rate-limits on IP *before* its own no-cookie shortcut. Thirty anonymous first-loads from one NAT inside five minutes exhaust the bucket, and the next signed-in user on that network whose token has just lapsed is logged out mid-session by other people's page views. A demo from a university lab is exactly this shape.

- [ ] **Step 1: Write the failing tests**

For `NO_REFRESH`, append to `src/lib/api.test.ts`:

```ts
describe("M2 — an anonymous bootstrap does not spend a refresh attempt", () => {
  it("does not refresh when /api/auth/me answers 401", async () => {
    respondWith(401);

    await api.get("/api/auth/me").catch(() => {});

    // Every anonymous visitor gets this 401 on first paint. Treating it as a lapsed
    // session cost one of thirty refresh attempts per IP per five minutes.
    expect(refreshCalls()).toHaveLength(0);
  });
});
```

For `returnTo`, in `src/components/ProtectedRoute.component.test.tsx`:

```tsx
it("M5 — carries the attempted path into the login redirect", () => {
  mockPathname("/orders/412");
  mockAuth({ isAuthenticated: false, loading: false });

  render(<ProtectedRoute><p>secret</p></ProtectedRoute>);

  expect(replaceSpy).toHaveBeenCalledWith("/login?returnTo=%2Forders%2F412");
});
```

And in the login page's component test:

```tsx
it("M5 — sends the user where they were going after a password sign-in", async () => {
  const user = userEvent.setup();
  renderLogin({ searchParams: "returnTo=/orders/412" });

  await signIn(user);

  expect(pushSpy).toHaveBeenCalledWith("/orders/412");
});

it("M5 — refuses a returnTo that points off-site", async () => {
  const user = userEvent.setup();
  renderLogin({ searchParams: "returnTo=https://evil.example/steal" });

  await signIn(user);

  expect(pushSpy).toHaveBeenCalledWith("/");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --project unit src/lib/api.test.ts` and `npm test -- --project component src/components/ProtectedRoute.component.test.tsx "src/app/(frontend)/login/page.component.test.tsx"`

Expected: FAIL — a refresh fires for `/api/auth/me`, the redirect carries no `returnTo`, and the password path pushes `/`.

- [ ] **Step 3: Implement — NO_REFRESH**

`src/lib/api.ts:23`:

```ts
/**
 * Endpoints whose own 401 is a real answer rather than an expired session.
 *
 * Refreshing after a rejected login would turn "wrong password" into two requests and
 * the same rejection; refreshing after a failed refresh is an infinite loop. And
 * `/api/auth/me` answers 401 for every anonymous visitor on first paint — treating
 * that as a lapsed session spent one of the thirty refresh attempts allowed per IP per
 * five minutes, so enough anonymous first-loads behind one NAT could log out a signed-in
 * user on the same network.
 */
const NO_REFRESH = [
  REFRESH_ENDPOINT,
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/me",
];
```

- [ ] **Step 4: Implement — the refresh route's check order**

In `src/app/api/auth/refresh/route.ts`, move the no-refresh-cookie early return **above** the rate-limit call. A request with no refresh cookie cannot be a refresh attempt, so it must not consume the bucket. Keep the rate limit for requests that do present a cookie.

Add an integration assertion in `src/app/api/rate-limits.integration.test.ts`:

```ts
it("M2 — a cookieless refresh does not consume the bucket", async () => {
  // Thirty of these used to exhaust the IP's allowance and lock out the next real
  // refresh from that network.
  for (let i = 0; i < 35; i += 1) {
    const res = await postRefresh({ cookie: null });
    expect(res.status).toBe(401);
  }

  const real = await postRefresh({ cookie: await validRefreshCookie() });
  expect(real.status).toBe(200);
});
```

- [ ] **Step 5: Implement — returnTo**

`ProtectedRoute.tsx`, replacing the unauthenticated branch:

```tsx
    if (!isAuthenticated) {
      // Without this the user signs in and lands on the home page, and the link they
      // followed is gone from history because this is a replace.
      const returnTo = `${pathname}${window.location.search}`;
      router.replace(`${redirectTo}?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
```

Add `const pathname = usePathname();` and include `pathname` in the effect's dependency array.

`login/page.tsx`, in `handleSubmit`:

```tsx
      await login(email, password);
      toast.success("Welcome back!");
      // safeReturnTo already exists for the OAuth path; the password path ignored it.
      router.push(safeReturnTo(returnTo));
```

Import `safeReturnTo` from `@/lib/oauth/return-to`. Also change the already-authenticated redirect at `:33-35` from `router.replace("/")` to `router.replace(safeReturnTo(returnTo))`, so arriving at `/login?returnTo=…` while already signed in lands in the same place.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --project unit src/lib/api.test.ts`, then `npm test -- --project component src/components/ProtectedRoute.component.test.tsx "src/app/(frontend)/login/page.component.test.tsx"`, then `npm test -- --project integration src/app/api/rate-limits.integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Deliberate break**

Replace `safeReturnTo(returnTo)` with `returnTo ?? "/"` in the login submit.

Run: `npm test -- --project component "src/app/(frontend)/login/page.component.test.tsx" -t "points off-site"`

Expected: FAIL — the off-site URL is pushed. Restore and confirm PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/ProtectedRoute.tsx "src/app/(frontend)/login/page.tsx" src/lib/api.ts src/app/api/auth/refresh/route.ts src/app/api/rate-limits.integration.test.ts src/lib/api.test.ts
git commit -m "fix(fe): keep the destination through sign-in; stop anonymous loads burning refresh attempts (M5, M2)"
```

Body: the login page read `returnTo`, forwarded it to the OAuth buttons and then ignored it on the password path, and `ProtectedRoute` never sent one — so a shared link to /orders/412 became the home page, with the original gone from history because the redirect was a replace. Separately `/api/auth/me`'s anonymous 401 triggered a refresh, and the refresh route rate-limited before its own no-cookie shortcut, so anonymous page views behind one NAT could log out a signed-in user on the same network.

---

### Task 12: Exchange rates — timeout, cache, retry, and close the mislabel path

Closes **H14** (see the note below on its severity) and **L11**.

**Files:**
- Modify: `src/hooks/useCurrencyConversion.ts`
- Test: `src/hooks/useCurrencyConversion.component.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the hook's return shape is unchanged.

**Severity note — read this before starting.** The spec promoted this finding on the review's claim that a missing rate "returns USD amounts labelled EUR". That claim was checked while writing this plan and **it is defended by construction**: `availableCurrencies` (`:52-54`) is derived from the rates that actually arrived, and `CurrencySelect:58` only offers those, so `selectedCurrency` always has a rate. The `?? 1` at `:57` is a **latent** defect, not a live one.

What is real and user-visible:

- `fetch` at `:25` has **no `AbortSignal`**, so a hung third-party host leaves `loadingRates` true forever and the currency `<select>` — which is `disabled={loadingRates}` — permanently disabled on all four pages that use it.
- The same uncached request fires on every visit to each of those four pages.
- There is no retry, so one transient failure disables the feature for the life of the page.

Fix all three, and harden the `?? 1` so the latent defect cannot become live if `availableCurrencies` is ever refactored.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useCurrencyConversion.component.test.tsx`:

```tsx
/**
 * The rates come from a third-party host with no timeout, no retry and no cache, on
 * four separate pages. A hung host left the currency control disabled forever, because
 * CurrencySelect disables itself while `loadingRates` is true.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { useCurrencyConversion, __resetRatesCache } from "./useCurrencyConversion";

beforeEach(() => {
  __resetRatesCache();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCurrencyConversion", () => {
  it("gives up on a hung host instead of loading forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      ),
    );

    const { result } = renderHook(() => useCurrencyConversion());
    expect(result.current.loadingRates).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });

    // Without a timeout the select stays disabled for the life of the page.
    await waitFor(() => expect(result.current.loadingRates).toBe(false));
    expect(result.current.ratesError).toMatch(/exchange rates/i);
  });

  it("fetches once for two consumers rather than once each", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ rates: { EUR: 0.9 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = renderHook(() => useCurrencyConversion());
    const second = renderHook(() => useCurrencyConversion());

    await waitFor(() => expect(first.result.current.loadingRates).toBe(false));
    await waitFor(() => expect(second.result.current.loadingRates).toBe(false));

    // Four pages each fetching the same rates uncached is the waste this closes.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once before reporting failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rates: { EUR: 0.9 } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCurrencyConversion());

    await waitFor(() => expect(result.current.loadingRates).toBe(false));
    expect(result.current.ratesError).toBeNull();
    expect(result.current.availableCurrencies).toContain("EUR");
  });

  it("never formats an unconverted amount under another currency's symbol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ rates: {} }), { status: 200 })),
    );

    const { result } = renderHook(() => useCurrencyConversion());
    await waitFor(() => expect(result.current.loadingRates).toBe(false));

    // Latent today because availableCurrencies is derived from `rates`. Pinned so a
    // refactor of that invariant cannot silently start mislabelling money.
    act(() => { result.current.setSelectedCurrency("EUR"); });

    expect(result.current.formatConverted(100)).not.toMatch(/€\s?100\.00/);
    expect(result.current.formatConverted(100)).toMatch(/100\.00/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --project component src/hooks/useCurrencyConversion.component.test.tsx`

Expected: FAIL — `__resetRatesCache` is not exported, there is no timeout, two consumers fetch twice, and no retry exists.

- [ ] **Step 3: Implement**

Rewrite the loading half of `src/hooks/useCurrencyConversion.ts`:

```tsx
const RATES_URL = "https://open.er-api.com/v6/latest/USD";
const RATES_TIMEOUT_MS = 8000;
/** Rates move slowly; four pages refetching them on every visit is pure waste. */
const RATES_TTL_MS = 60 * 60 * 1000;

type CacheEntry = { rates: Record<string, number>; fetchedAt: number };

/**
 * Module-level so the four pages that use this hook share one request.
 *
 * `inFlight` is the single-flight guard: two components mounting together must not
 * produce two requests to a third-party host.
 */
let cache: CacheEntry | null = null;
let inFlight: Promise<Record<string, number>> | null = null;

/** Test seam: drops the cache so one test cannot leak into the next. */
export function __resetRatesCache(): void {
  cache = null;
  inFlight = null;
}

async function fetchRatesOnce(): Promise<Record<string, number>> {
  // No timeout at all previously: a hung host left `loadingRates` true forever, and
  // CurrencySelect disables itself while that is true — so the feature died silently.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RATES_TIMEOUT_MS);

  try {
    const response = await fetch(RATES_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to load exchange rates (${response.status})`);
    }
    const data = (await response.json()) as RatesResponse;
    if (!data.rates || typeof data.rates !== "object") {
      throw new Error("Unexpected exchange rates response");
    }
    return { USD: 1, ...data.rates };
  } finally {
    clearTimeout(timer);
  }
}

function loadRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < RATES_TTL_MS) {
    return Promise.resolve(cache.rates);
  }

  inFlight ??= (async () => {
    try {
      let rates: Record<string, number>;
      try {
        rates = await fetchRatesOnce();
      } catch {
        // One retry. A single transient failure otherwise disabled the currency
        // control for the life of the page.
        rates = await fetchRatesOnce();
      }
      cache = { rates, fetchedAt: Date.now() };
      return rates;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
```

The effect becomes:

```tsx
  useEffect(() => {
    let alive = true;

    loadRates()
      .then((loaded) => {
        if (!alive) return;
        setRates(loaded);
        setRatesError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setRatesError(
          err instanceof Error ? err.message : "Failed to load exchange rates",
        );
      })
      .finally(() => {
        if (alive) setLoadingRates(false);
      });

    return () => {
      alive = false;
    };
  }, []);
```

The `alive` guard is unchanged — do not touch it (global constraint 6).

Finally, harden `convertFromUsd` and `formatConverted`:

```tsx
  function convertFromUsd(amountUsd: number): number | null {
    const rate = rates[selectedCurrency];
    // Previously `?? 1`, which returned the USD amount unchanged — and then
    // formatConverted stamped the selected currency's symbol on it. Unreachable today
    // because availableCurrencies is derived from `rates`, but that is an invariant
    // held somewhere else, and the failure mode is wrong money.
    return rate === undefined ? null : amountUsd * rate;
  }

  function formatConverted(amountUsd: number): string {
    const converted = convertFromUsd(amountUsd);
    if (converted === null) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: selectedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(converted);
  }
```

`convertFromUsd`'s return type changed. Run `npx tsc --noEmit` and fix any consumer that assumed a number.

- [ ] **Step 4: Address L11 while here**

`formatConverted` is prop-drilled three levels down two separate trees. Rather than drill it further, note that `CurrencySelect` already takes the whole conversion object. Leave the existing drilling in place — restructuring it is a larger refactor than this finding warrants — but add a short comment at the hook's export explaining that consumers should pass `conversion` whole rather than picking `formatConverted` out and threading it, and fix the one deepest drill if it is a single-file change. If it is not, record it as deferred in your task report with the exact files.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --project component src/hooks/useCurrencyConversion.component.test.tsx`, then the whole component project since `formatConverted` output changed for the missing-rate case.

Expected: PASS.

- [ ] **Step 6: Deliberate break**

Remove the `AbortController` and its `signal`.

Run: `npm test -- --project component src/hooks/useCurrencyConversion.component.test.tsx -t "hung host"`

Expected: FAIL — `loadingRates` never becomes false. Restore and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useCurrencyConversion.ts src/hooks/useCurrencyConversion.component.test.tsx
git commit -m "fix(fe): time out, cache and retry the exchange-rate fetch (H14, L11)"
```

Body must record the severity correction: the review's "USD amounts labelled EUR" is latent rather than live, because `availableCurrencies` is derived from the rates that arrived; the live defects are the missing timeout (a hung host disabled the currency control permanently, since the select disables itself while loading), the uncached refetch on four pages, and the absence of a retry. The `?? 1` is replaced with an explicit null so the latent path cannot become live.

---

### Task 13: The price field accepts a comma decimal

Closes **M6**.

**Files:**
- Modify: `src/components/listings/ListingForm.tsx:249-258` (the Price `InputField`) and the validation at `:139-142`
- Test: `src/components/listings/ListingForm.component.test.tsx` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

**Background.** `<input type="number">` reports an **empty value** for anything the browser considers malformed. This app ships RSD in its currency list; the decimal separator people type there is a comma. Type `1500,50`, press Create, and you are told "Title, description, and price are required" while looking at three visibly filled fields.

- [ ] **Step 1: Write the failing test**

```tsx
describe("M6 — a comma decimal is a price, not an empty field", () => {
  it("accepts 1500,50 and submits 1500.5", async () => {
    const user = userEvent.setup();
    renderCreateForm();
    await fillTitleAndDescription(user);

    await user.type(screen.getByLabelText(/price/i), "1500,50");
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    await waitFor(() =>
      expect(createListingBody()).toMatchObject({ price: 1500.5 }),
    );
    expect(
      screen.queryByText(/title, description, and price are required/i),
    ).toBeNull();
  });

  it("still rejects text that is not a price", async () => {
    const user = userEvent.setup();
    renderCreateForm();
    await fillTitleAndDescription(user);

    await user.type(screen.getByLabelText(/price/i), "abc");
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    expect(await screen.findByText(/enter a price like 19\.99/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --project component src/components/listings/ListingForm.component.test.tsx`

Expected: FAIL — the browser reports an empty value for `1500,50`, so the required-fields message appears.

- [ ] **Step 3: Implement**

Change the input from `type="number"` to a text input that still raises a numeric keypad on phones:

```tsx
        <InputField
          label="Price"
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder="0.00"
          error={priceError}
          required
        />
```

`min` and `step` do not apply to a text input; drop them and enforce the same rules in code. Add a normaliser above the component:

```tsx
/**
 * Parses what a person typed into a price.
 *
 * `<input type="number">` reports an empty value for anything the browser thinks is
 * malformed, and this app lists RSD — where the decimal separator people type is a
 * comma. "1500,50" arrived as "" and the form said the price was required while the
 * field visibly held a number.
 */
export function parsePriceInput(raw: string): number | null {
  const normalised = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;
  const value = Number(normalised);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
```

Replace the price half of the submit validation at `:139-142`:

```tsx
    const parsedPrice = parsePriceInput(price);

    if (!title.trim() || !description.trim() || !price.trim()) {
      setSubmitError("Title, description, and price are required");
      return;
    }

    if (parsedPrice === null) {
      setPriceError("Enter a price like 19.99");
      return;
    }
    setPriceError(null);
```

and use `price: parsedPrice` in the payload instead of `Number(price)`.

Add `const [priceError, setPriceError] = useState<string | null>(null);`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- --project component src/components/listings/ListingForm.component.test.tsx`

Expected: PASS.

- [ ] **Step 5: Deliberate break**

Remove `.replace(",", ".")` from `parsePriceInput`.

Run: `npm test -- --project component src/components/listings/ListingForm.component.test.tsx -t "accepts 1500,50"`

Expected: FAIL. Restore and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/listings/ListingForm.tsx src/components/listings/ListingForm.component.test.tsx
git commit -m "fix(fe): accept a comma decimal in the price field (M6)"
```

Body: `<input type="number">` reports an empty value for anything the browser considers malformed, and this app ships RSD, where the decimal separator people type is a comma — so "1500,50" produced "Title, description, and price are required" over three visibly filled fields. Now a text input with `inputMode="decimal"` and an explicit parser, which also gives a real field-level error instead of the catch-all banner.

---

## Wave 2 gate

Controller runs, backgrounded: `npm test`, `npm run build`, `npx tsc --noEmit`, `npm run lint`. All must be clean before wave 3 starts.

---

# Wave 3 — Accessibility batch

Individually small; together they move the accessibility score more than anything else in the plan.

---

### Task 14: `Card` becomes a link instead of a `role="button"` div

Closes **H7**.

**Files:**
- Modify: `src/components/ui/Card.tsx:35-53, 103, 111-120`
- Modify: `src/components/seller/SellerListingCard.tsx:57` and any other `onClick` caller
- Test: `src/components/ui/Card.component.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `CardProps` gains `href?: string` and **removes** `onClick`. Callers pass a destination, not a handler.

**Background.** Descendants of an ARIA button are presentational, so the accessibility tree flattens the whole card into one control whose name is every string inside it. The Disable and Delete buttons in the footer become unreachable or are read as part of the parent's name, and the `<h3>` listing title stops being a heading. Space activates without `preventDefault()`, so it also scrolls the page.

It should be a link: `onOpen` is a `router.push`, and as a div it loses middle-click and open-in-new-tab. On `/listings` and `/orders` the same component is used **without** `onClick` and is fine — that is the pattern to copy.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Card.component.test.tsx`:

```tsx
/**
 * role="button" on a div containing a heading and nested buttons flattens the whole
 * card into one control in the accessibility tree. The footer's Disable and Delete
 * buttons become unreachable, and the h3 stops being a heading.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import Card from "./Card";

describe("Card — an openable card is a link", () => {
  it("exposes a link named by its title, not a button named by everything inside", () => {
    render(
      <Card
        title="Blue bicycle"
        description="$120.00"
        href="/listings/7"
        footer={<button>Delete</button>}
      />,
    );

    const link = screen.getByRole("link", { name: "Blue bicycle" });
    expect(link).toHaveAttribute("href", "/listings/7");
    expect(screen.queryByRole("button", { name: /Blue bicycle/ })).toBeNull();
  });

  it("keeps the title a heading", () => {
    render(<Card title="Blue bicycle" href="/listings/7" />);
    expect(screen.getByRole("heading", { name: "Blue bicycle" })).toBeInTheDocument();
  });

  it("leaves footer controls independently reachable", () => {
    render(
      <Card title="Blue bicycle" href="/listings/7" footer={<button>Delete</button>} />,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("renders no link at all when there is nowhere to go", () => {
    // This is how /listings and /orders already use it, and it was always correct.
    render(<Card title="Blue bicycle" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --project component src/components/ui/Card.component.test.tsx`

Expected: FAIL — there is no `href` prop and the card renders `role="button"`.

- [ ] **Step 3: Implement**

In `CardProps`, replace `onClick?: () => void` with:

```tsx
  /**
   * Where the card goes when opened. Renders the title as a link.
   *
   * Was an `onClick` that did a `router.push`, on a div with `role="button"` — which
   * flattened the heading and the footer buttons into the card's accessible name, and
   * lost middle-click and open-in-new-tab.
   */
  href?: string;
```

Delete `isClickable`, the `role`, `tabIndex`, `onClick` and `onKeyDown` from the wrapper div, and keep only the hover styling, conditioned on `href`:

```tsx
    <div
      className={[
        "group flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm",
        "transition-shadow duration-200",
        href ? "hover:shadow-md" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
```

Wrap the title in a link that stretches over the card's non-interactive area, so the whole card stays clickable without swallowing the footer:

```tsx
        <h3 className="line-clamp-2 font-semibold text-zinc-900">
          {href ? (
            <Link
              href={href}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
```

Add `relative` to the wrapper div's class list so the stretched pseudo-element is bounded by the card, and add `relative z-10` to the footer wrapper so its buttons sit above the stretched link. The footer's `onClick`/`onKeyDown` stop-propagation handlers are no longer needed — delete them, and delete the comment that explained them.

Import `Link` from `next/link`.

- [ ] **Step 4: Update the callers**

Run `grep -rn "<Card" src --include=*.tsx | grep -v "\.test\."` and change every `onClick={() => router.push(x)}` to `href={x}`. `SellerListingCard.tsx:57` is the main one. If any caller's `onClick` does something other than navigate, stop and report it rather than forcing it into `href`.

- [ ] **Step 5: Run the tests**

Run: `npm test -- --project component` — the browse, seller and orders pages all render cards.

Expected: PASS. A test that clicked the card body and asserted a `router.push` now needs to assert the link's `href` instead; that is a correct change, not a weakening.

- [ ] **Step 6: Deliberate break**

Re-add `role="button"` to the wrapper div.

Run: `npm test -- --project component src/components/ui/Card.component.test.tsx -t "not a button named by everything"`

Expected: FAIL. Restore and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/Card.tsx src/components/ui/Card.component.test.tsx src/components/seller
git commit -m "fix(a11y): Card is a link, not a role=button div (H7)"
```

---

### Task 15: An `h1` and named landmarks on the browse page

Closes **H8**.

**Files:**
- Modify: `src/app/(frontend)/listings/page.tsx`
- Test: `src/app/(frontend)/listings/page.component.test.tsx` (append)

**Background.** The first heading rendered is the `<h3>` inside each card. The filter form and the results grid are both bare `<section>`s with no accessible name, so the landmark list shows two unnamed regions. Every other page gets this right — 12 of 14 have exactly one `h1` — which makes the primary browse page the odd one out.

- [ ] **Step 1: Write the failing test**

```tsx
describe("H8 — the browse page has a heading hierarchy", () => {
  it("has exactly one h1", async () => {
    renderPage();
    const h1s = await screen.findAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(/browse listings/i);
  });

  it("names both landmark regions", async () => {
    renderPage();
    expect(await screen.findByRole("region", { name: /filters/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /results/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --project component "src/app/(frontend)/listings/page.component.test.tsx"`

Expected: FAIL — no `h1`, and `getByRole("region")` finds nothing because an unnamed `<section>` is not exposed as a region.

- [ ] **Step 3: Implement**

Add the page heading above the filter section:

```tsx
      <h1 className="text-2xl font-bold text-zinc-900">Browse listings</h1>
```

Name the two sections. A `<section>` only becomes a `region` landmark once it has an accessible name:

```tsx
      <section
        aria-labelledby="filters-heading"
        className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
      >
        <h2 id="filters-heading" className="sr-only">
          Filters
        </h2>
```

and for the results grid:

```tsx
      <section aria-labelledby="results-heading">
        <h2 id="results-heading" className="sr-only">
          Results
        </h2>
```

- [ ] **Step 4: Run it to verify it passes, then deliberate break**

Run the file → PASS. Then delete `aria-labelledby="filters-heading"` and re-run `-t "names both landmark regions"` → FAIL. Restore.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(frontend)/listings/page.tsx" "src/app/(frontend)/listings/page.component.test.tsx"
git commit -m "fix(a11y): give the browse page an h1 and named landmarks (H8)"
```

---

### Task 16: The star rating is a radio group

Closes **H9**.

**Files:**
- Modify: `src/components/reviews/ReviewForm.tsx:69-84`
- Test: `src/components/reviews/ReviewForm.component.test.tsx` (append)

**Background.** They are real buttons, so the widget is keyboard operable — that half is fine. But there is no `role="radiogroup"`, no `aria-checked`, no `aria-pressed`, and the "Star rating" label is an unassociated `<p>`. The form opens pre-filled at 5, conveyed only by a ★/☆ glyph swap. A screen reader user hears five identically-shaped buttons, gets no confirmation when they pick one, and may submit the default 5 believing they chose 3.

The **display** component, `StarRating.tsx`, is done well — `role="img"` with the exact value in its label and a words-not-stars fallback. Copy its honesty.

- [ ] **Step 1: Write the failing test**

```tsx
describe("H9 — the rating input exposes its value", () => {
  it("is a named radio group", async () => {
    renderReviewForm();
    await openTheDialog();
    expect(screen.getByRole("radiogroup", { name: /star rating/i })).toBeInTheDocument();
  });

  it("reports which rating is selected", async () => {
    renderReviewForm();
    await openTheDialog();

    // The form opens pre-filled at 5, previously conveyed only by a glyph swap.
    expect(screen.getByRole("radio", { name: "5 stars" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "3 stars" })).not.toBeChecked();
  });

  it("moves the selection when a rating is chosen", async () => {
    const user = userEvent.setup();
    renderReviewForm();
    await openTheDialog();

    await user.click(screen.getByRole("radio", { name: "3 stars" }));

    expect(screen.getByRole("radio", { name: "3 stars" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "5 stars" })).not.toBeChecked();
  });

  it("names one star in the singular", async () => {
    renderReviewForm();
    await openTheDialog();
    expect(screen.getByRole("radio", { name: "1 star" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — no radiogroup, no checked state.

- [ ] **Step 3: Implement**

```tsx
          <div className="space-y-2">
            <span id="star-rating-label" className="block text-sm font-medium text-zinc-700">
              Star rating
            </span>
            <div
              role="radiogroup"
              aria-labelledby="star-rating-label"
              className="flex items-center gap-1"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={value === rating}
                  // Only the selected control stays in the tab order; arrow keys move
                  // within the group, which is the radio pattern users expect.
                  tabIndex={value === rating ? 0 : -1}
                  onClick={() => setRating(value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      event.preventDefault();
                      setRating(value === 5 ? 1 : value + 1);
                    }
                    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      event.preventDefault();
                      setRating(value === 1 ? 5 : value - 1);
                    }
                  }}
                  className="text-2xl leading-none text-amber-500"
                  aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
                >
                  <span aria-hidden="true">{value <= rating ? "★" : "☆"}</span>
                </button>
              ))}
            </div>
          </div>
```

Roving `tabIndex` means the arrow-key handler must also move focus. Add a ref array and focus the newly selected control inside an effect keyed on `rating`, or call `event.currentTarget.parentElement?.children[next]?.focus()` directly — either is acceptable; the test asserts the checked state, and the roving tabindex is what makes it a real radio group.

- [ ] **Step 4: Run, then deliberate break**

Run the file → PASS. Then change `aria-checked={value === rating}` to `aria-checked={false}` and re-run `-t "reports which rating is selected"` → FAIL. Restore.

- [ ] **Step 5: Commit**

```bash
git add src/components/reviews/ReviewForm.tsx src/components/reviews/ReviewForm.component.test.tsx
git commit -m "fix(a11y): the star rating input is a radio group (H9)"
```

---

### Task 17: The seller tabs stop claiming to be a tab widget

Closes **H10**.

**Files:**
- Modify: `src/app/(frontend)/seller/page.tsx:24-42, 75, 92-101`
- Test: `src/app/(frontend)/seller/page.component.test.tsx` (create if absent)

**Background.** The ARIA tabs pattern is declared and not implemented: no `role="tabpanel"`, no `aria-controls`, no roving tabindex, no arrow-key navigation. A screen reader user is told they are in a tab widget, presses Right expecting to move, and nothing happens.

**The fix is to stop lying, not to build the widget.** Removing `role="tab"` and using `aria-current` on plain buttons is honest and costs nothing. These are two view switches, not a tab panel with managed focus.

- [ ] **Step 1: Write the failing test**

```tsx
describe("H10 — the dashboard does not claim to be a tab widget", () => {
  it("offers plain buttons, not tabs", async () => {
    renderSellerDashboard();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      await screen.findByRole("button", { name: /incoming orders/i }),
    ).toBeInTheDocument();
  });

  it("marks the active view with aria-current", async () => {
    const user = userEvent.setup();
    renderSellerDashboard();

    const orders = await screen.findByRole("button", { name: /incoming orders/i });
    const listings = screen.getByRole("button", { name: /my listings/i });

    expect(orders).toHaveAttribute("aria-current", "true");
    expect(listings).not.toHaveAttribute("aria-current");

    await user.click(listings);
    expect(listings).toHaveAttribute("aria-current", "true");
    expect(orders).not.toHaveAttribute("aria-current");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `role="tab"` and `role="tablist"` are present.

- [ ] **Step 3: Implement**

In `TabButton`, delete `role="tab"` and `aria-selected`, and add:

```tsx
      aria-current={active ? "true" : undefined}
```

Delete `role="tablist"` from the wrapper at `:75`. Rename `TabButton` to `ViewButton` and add a comment recording the decision:

```tsx
/**
 * A view switch, deliberately not an ARIA tab.
 *
 * The tabs pattern was declared here without tabpanels, aria-controls, roving tabindex
 * or arrow-key navigation, so a screen reader user was told they were in a tab widget
 * and then found the arrow keys did nothing. Two view switches do not need the pattern;
 * they need to be honest about what they are.
 */
```

- [ ] **Step 4: Run, then deliberate break**

Run the file → PASS. Re-add `role="tab"` and re-run `-t "not tabs"` → FAIL. Restore.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(frontend)/seller/page.tsx" "src/app/(frontend)/seller/page.component.test.tsx"
git commit -m "fix(a11y): the seller dashboard stops claiming to be a tab widget (H10)"
```

---

### Task 18: The register role selector conveys its selection to everyone

Closes **M11**.

**Files:**
- Modify: `src/app/(frontend)/register/page.tsx:148-171`
- Test: `src/app/(frontend)/register/page.component.test.tsx` (append or create)

**Background.** Buyer-or-seller decides whether the account can ever create a listing. Selected state is `border-indigo-600 bg-indigo-50` and **nothing else** — no `aria-pressed`, no radio semantics, the group label unassociated, and the emoji unhidden so the accessible name is "shopping bags Buy". Unlike the shared `InputField`, requiredness here is purely visual.

- [ ] **Step 1: Write the failing test**

```tsx
describe("M11 — the role selector is not colour-only", () => {
  it("is a named, required radio group", async () => {
    renderRegister();
    const group = await screen.findByRole("radiogroup", { name: /i want to/i });
    expect(group).toHaveAttribute("aria-required", "true");
  });

  it("names the options without reading the emoji", async () => {
    renderRegister();
    expect(await screen.findByRole("radio", { name: "Buy" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Sell" })).toBeInTheDocument();
  });

  it("reports the selection", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.click(await screen.findByRole("radio", { name: "Sell" }));

    expect(screen.getByRole("radio", { name: "Sell" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Buy" })).not.toBeChecked();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — no radiogroup; the accessible names include the emoji.

- [ ] **Step 3: Implement**

```tsx
            <div className="flex flex-col gap-1">
              <span id="role-label" className="text-sm font-medium text-zinc-700">
                I want to&hellip;
                <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
              </span>
              <div
                role="radiogroup"
                aria-labelledby="role-label"
                aria-required="true"
                className="grid grid-cols-2 gap-2"
              >
                {(["buyer", "seller"] as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={role === r}
                    tabIndex={role === r ? 0 : -1}
                    onClick={() => setRole(r)}
                    className={[
                      "rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors",
                      role === r
                        ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                        : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400",
                    ].join(" ")}
                  >
                    {/* The emoji is decoration; unhidden it made the accessible name
                        "shopping bags Buy". */}
                    <span aria-hidden="true">{r === "buyer" ? "🛍" : "🏪"}</span>{" "}
                    {r === "buyer" ? "Buy" : "Sell"}
                  </button>
                ))}
              </div>
            </div>
```

- [ ] **Step 4: Run, then deliberate break**

Run → PASS. Remove `aria-checked` and re-run `-t "reports the selection"` → FAIL. Restore.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(frontend)/register/page.tsx" "src/app/(frontend)/register/page.component.test.tsx"
git commit -m "fix(a11y): the register role selector is a real radio group (M11)"
```

---

### Task 19: Summarise form errors and move focus to them

Closes **M10**.

**Files:**
- Create: `src/components/ui/FormErrorSummary.tsx`
- Modify: `src/app/(frontend)/login/page.tsx:50-64`, `src/app/(frontend)/register/page.tsx:48-65`, `src/components/listings/ListingForm.tsx:139-142`
- Test: `src/components/ui/FormErrorSummary.component.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `export default function FormErrorSummary({ errors }: { errors: Array<{ field: string; message: string }> })` — renders nothing when `errors` is empty, otherwise a focusable `role="alert"` list of links to each field.

**Background.** A blank submit on `/register` fires three simultaneous `role="alert"` regions, which queue or clobber each other — the user hears one message or a fragment, with no idea how many fields failed. `ListingForm` is weaker still: three possible failures collapse into one banner string with no field-level error at all, rendered **above** the form where a keyboard user tabbing forward never encounters it.

- [ ] **Step 1: Write the failing test**

```tsx
import FormErrorSummary from "./FormErrorSummary";

describe("FormErrorSummary", () => {
  it("renders nothing when there are no errors", () => {
    const { container } = render(<FormErrorSummary errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many fields failed", () => {
    render(
      <FormErrorSummary
        errors={[
          { field: "email", message: "Email is required" },
          { field: "password", message: "Password is required" },
        ]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/2 fields need attention/i);
  });

  it("links each message to its field", () => {
    render(<FormErrorSummary errors={[{ field: "email", message: "Email is required" }]} />);
    expect(screen.getByRole("link", { name: "Email is required" })).toHaveAttribute(
      "href",
      "#email",
    );
  });

  it("takes focus so a keyboard user meets it immediately", () => {
    render(<FormErrorSummary errors={[{ field: "email", message: "Email is required" }]} />);
    // Rendered above the form, where tabbing forward would never reach it.
    expect(screen.getByRole("alert")).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { useEffect, useRef } from "react";

export type FieldError = { field: string; message: string };

/**
 * One summary for a form's validation failures.
 *
 * Three simultaneous `role="alert"` regions queue or clobber each other, so a user
 * submitting a blank form heard one message or a fragment and had no idea how many
 * fields had failed. This is rendered above the form — where a keyboard user tabbing
 * forward would never reach it — so it takes focus when it appears.
 */
export default function FormErrorSummary({ errors }: { errors: FieldError[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errors.length > 0) ref.current?.focus();
  }, [errors]);

  if (errors.length === 0) return null;

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="rounded-lg border border-red-200 bg-red-50 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
    >
      <p className="text-sm font-medium text-red-800">
        {errors.length} {errors.length === 1 ? "field needs" : "fields need"} attention
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700">
        {errors.map((error) => (
          <li key={error.field}>
            <a href={`#${error.field}`} className="underline">
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Adopt it in the three forms**

- **`login/page.tsx`** — build the array from `fieldErrors` and render `<FormErrorSummary errors={…} />` in place of the individual alert regions. Keep the per-field `error` prop on `InputField`, which is already wired correctly through `aria-describedby`; the summary is additive.
- **`register/page.tsx`** — same, replacing the three simultaneous alerts.
- **`ListingForm.tsx`** — this one has no field-level errors at all. Split the single "Title, description, and price are required" string into per-field entries:

```tsx
    const problems: FieldError[] = [];
    if (!title.trim()) problems.push({ field: "listing-title", message: "Title is required" });
    if (!description.trim())
      problems.push({ field: "listing-description", message: "Description is required" });
    if (!price.trim()) problems.push({ field: "listing-price", message: "Price is required" });
    if (parsedPrice === null && price.trim())
      problems.push({ field: "listing-price", message: "Enter a price like 19.99" });

    setFieldProblems(problems);
    if (problems.length > 0) return;
```

Each `InputField` needs a matching `id` so the summary's links land. `InputField` uses `useId()` internally, so add an explicit `id` prop pass-through if one does not exist, or give each field a stable wrapper id to anchor to. Note in your report which you chose.

This supersedes the `priceError` state added in Task 13 — fold it into `problems` rather than keeping both.

- [ ] **Step 5: Run the tests**

Run: `npm test -- --project component src/components/ui/FormErrorSummary.component.test.tsx "src/app/(frontend)/login/page.component.test.tsx" "src/app/(frontend)/register/page.component.test.tsx" src/components/listings/ListingForm.component.test.tsx`

Expected: PASS. Task 13's comma-decimal test must still pass — its message now arrives through the summary.

- [ ] **Step 6: Deliberate break**

Remove the focus effect.

Run: `npm test -- --project component src/components/ui/FormErrorSummary.component.test.tsx -t "takes focus"`

Expected: FAIL. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/FormErrorSummary.tsx src/components/ui/FormErrorSummary.component.test.tsx "src/app/(frontend)/login" "src/app/(frontend)/register" src/components/listings/ListingForm.tsx
git commit -m "fix(a11y): summarise form errors and move focus to them (M10)"
```

---

### Task 20: Contrast — measure first, then fix

Closes **M12**.

**Files:**
- Create: `src/lib/contrast.test.ts`
- Modify: the text sites listed in Step 3
- Test: `src/lib/contrast.test.ts` (both halves, per spec §7.3)

**Background.** `text-zinc-400` body text fails at roughly 2.5:1 against the 4.5:1 required. `CategoryBreadcrumb.tsx:46` is worse at `text-zinc-300` for real text content. `ProtectedRoute`'s "Checking authentication…" is the only content on screen during every auth check.

**Do not assume the replacement shade.** The review states `zinc-500` is 4.83:1, but this project is Tailwind **v4**, which defines the zinc scale in `oklch`, not the v3 hex values. Measure, then choose the lightest shade that clears 4.5:1.

**Not every occurrence is a violation.** Twelve sites use these shades; several are legitimately exempt:

| Site | Kind | Treatment |
| --- | --- | --- |
| `Footer.tsx:18` | body text | fix |
| `ProtectedRoute.tsx:26` | body text | fix |
| `listings/page.tsx:314` | body text | fix |
| `InputField.tsx:80` | placeholder text | fix — placeholders are text |
| `DescriptionAssistant.tsx:94` | "(optional)" text | fix |
| `CategoryBreadcrumb.tsx:46` | `›` separator glyph | decorative — keep, add `aria-hidden` and a justification comment |
| `InputField.tsx:86` | disabled text | **WCAG 1.4.3 exempts disabled controls** — keep with a justification comment |
| `Card.tsx:80`, `ListingGallery.tsx:33`, `EmptyState.tsx:24` | decorative placeholder glyphs | keep with justification comments |
| `CategoryTreeFilter.tsx:55`, `Modal.tsx:92` | icon buttons | fix — UI components need 3:1 and these do not clear it |

- [ ] **Step 1: Write the measuring half of the test**

Create `src/lib/contrast.test.ts`:

```ts
/**
 * WCAG 1.4.3 contrast, computed rather than asserted from memory.
 *
 * The review quoted v3 hex ratios; this project is Tailwind v4, whose zinc scale is
 * defined in oklch. The numbers below are the values the build actually ships, read
 * from the rendered palette — so this test tells you which shade to use rather than
 * assuming one.
 */
import { describe, expect, it } from "vitest";

/** sRGB hex -> relative luminance, per WCAG 2.1 definition. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

// The page background, from globals.css `--background`.
const PAGE = "#f8f9fc";
const WHITE = "#ffffff";

// Fill these in from Step 2 before implementing. They are the sRGB values Tailwind v4
// resolves the zinc scale to in this project's build.
const ZINC = {
  300: "#d4d4d8",
  400: "#a1a1aa",
  500: "#71717a",
  600: "#52525b",
} as const;

describe("the muted text shade clears WCAG AA", () => {
  it("names a shade that passes on both surfaces", () => {
    // MUTED_TEXT is exported from the app so there is one answer, not twelve.
    expect(contrastRatio(ZINC[500], WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ZINC[500], PAGE)).toBeGreaterThanOrEqual(4.5);
  });

  it("records why the previous shades were wrong", () => {
    expect(contrastRatio(ZINC[400], WHITE)).toBeLessThan(4.5);
    expect(contrastRatio(ZINC[300], WHITE)).toBeLessThan(4.5);
  });
});
```

- [ ] **Step 2: Run it and read the numbers**

Run: `npm test -- --project unit src/lib/contrast.test.ts`

If the `zinc-500` assertions **fail**, that is the test doing its job: v4's `zinc-500` does not clear 4.5:1 on this background. Change `ZINC[500]` to `ZINC[600]` in the passing assertion, re-run, and use `zinc-600` as the replacement shade throughout Step 3. **Record the measured ratios in your task report** — they are the evidence for the shade you picked.

If you cannot confirm the v4 sRGB values, print them from the built stylesheet rather than guessing.

- [ ] **Step 3: Fix the text sites**

Replace `text-zinc-400` with the shade Step 2 chose at: `Footer.tsx:18`, `ProtectedRoute.tsx:26`, `listings/page.tsx:314`, `InputField.tsx:80` (the `placeholder:` variant), `DescriptionAssistant.tsx:94`, `CategoryTreeFilter.tsx:55`, `Modal.tsx:92`.

At `CategoryBreadcrumb.tsx:46`, keep the shade but mark the glyph decorative:

```tsx
          {index > 0 && (
            /* Decorative separator, not content — contrast-exempt. The breadcrumb's
               structure is conveyed by the list markup added in Task 22. */
            <span className="text-zinc-300" aria-hidden="true">›</span>
          )}
```

At `InputField.tsx:86`, `Card.tsx:80`, `ListingGallery.tsx:33` and `EmptyState.tsx:24`, add a one-line justification comment naming the exemption — disabled control, or decorative glyph.

- [ ] **Step 4: Write the enforcement half of the test**

Append to `src/lib/contrast.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("the failing shades do not come back", () => {
  it("uses text-zinc-400 and text-zinc-300 only where a comment justifies it", () => {
    const offenders: string[] = [];

    for (const file of tsxFiles("src")) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/text-zinc-[34]00|placeholder:text-zinc-[34]00/.test(line)) return;
        // An exemption is a comment within the three lines above the usage saying
        // "contrast-exempt" and why.
        const context = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
        if (!/contrast-exempt/.test(context)) {
          offenders.push(`${file}:${index + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
```

Every exemption comment in Step 3 must contain the literal string `contrast-exempt`. Update them if they do not.

- [ ] **Step 5: Run both halves, then deliberate break**

Run: `npm test -- --project unit src/lib/contrast.test.ts` → PASS.

Break: revert `Footer.tsx:18` to `text-zinc-400`.
Run the file → FAIL, naming `Footer.tsx:18`. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/lib/contrast.test.ts src/components src/app
git commit -m "fix(a11y): raise muted text to a shade that clears 4.5:1 (M12)"
```

Body must record the **measured** ratios and which shade was chosen, and note that disabled text and decorative glyphs are exempt under WCAG 1.4.3 and carry `contrast-exempt` comments that the test honours.

---

### Task 21: Reduced motion and a skip link

Closes **M13**.

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/(frontend)/layout.tsx`
- Test: `src/lib/motion.test.ts` (create), `src/app/(frontend)/layout.component.test.tsx` (create)

**Background.** Smooth scrolling (`globals.css:57-59`), an infinite skeleton shimmer (`:70-86`), spinners, pulses and a hover scale, none of them conditional. A grid of eight shimmering skeletons on a slow connection animates indefinitely — the classic vestibular trigger. Separately, a signed-in seller passes eight tab stops in the navbar before reaching content on every page load, with no bypass.

**Spec §7.4 — this is the plan's weakest proof.** jsdom has no CSS engine, so the reduced-motion block cannot be *executed* under test. Its proof is a unit test asserting the block exists in the stylesheet. That is weaker than every other proof here; it is still falsifiable, which is the bar. Do not dress it up as more than it is.

- [ ] **Step 1: Write the failing tests**

`src/lib/motion.test.ts`:

```ts
/**
 * Weakest proof in the plan, and deliberately labelled as such (spec 7.4): jsdom has
 * no CSS engine, so the media query cannot be executed. This asserts the block exists
 * and covers the animations the app actually ships.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

describe("prefers-reduced-motion", () => {
  it("has a reduce block", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("neutralises the shimmer, which otherwise animates indefinitely", () => {
    const block = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(block).toMatch(/animation[^;]*none|animation-iteration-count[^;]*1/);
  });

  it("stops smooth scrolling", () => {
    const block = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(block).toMatch(/scroll-behavior:\s*auto/);
  });
});
```

`src/app/(frontend)/layout.component.test.tsx`:

```tsx
describe("M13 — a skip link bypasses the navbar", () => {
  it("is the first thing in the tab order", async () => {
    renderLayout();
    await userEvent.tab();
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveFocus();
  });

  it("points at the main landmark", () => {
    renderLayout();
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Expected: FAIL — no reduced-motion block, no skip link.

- [ ] **Step 3: Implement the reduced-motion block**

Append to `src/app/globals.css`:

```css
/* ─── Reduced motion ────────────────────────────────────────────────────────── */
/* A grid of eight shimmering skeletons on a slow connection animates indefinitely,
   which is the classic vestibular trigger. Everything here is decoration; none of it
   carries meaning, so switching it off costs nothing. */
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  .skeleton-shimmer {
    animation: none;
    background: #f3f4f6;
  }
}
```

- [ ] **Step 4: Implement the skip link**

In `src/app/(frontend)/layout.tsx`, add as the first child inside `AnnouncerProvider`'s wrapper div, and give `<main>` the target id:

```tsx
        <div className="flex min-h-screen flex-col">
          {/* A signed-in seller passes eight navbar tab stops before reaching content
              on every page load. Visible only when focused. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg focus:ring-2 focus:ring-indigo-500"
          >
            Skip to main content
          </a>
          <Navbar />
          <main
            id="main-content"
            className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6"
          >
            {children}
          </main>
          <Footer />
        </div>
```

- [ ] **Step 5: Run, then deliberate break**

Run both files → PASS. Delete the `.skeleton-shimmer` rule from the reduced-motion block and re-run `-t "neutralises the shimmer"` → FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css "src/app/(frontend)/layout.tsx" src/lib/motion.test.ts "src/app/(frontend)/layout.component.test.tsx"
git commit -m "fix(a11y): reduced-motion support and a skip link (M13)"
```

Body should state plainly that the reduced-motion proof is a stylesheet assertion rather than an executed one, because jsdom has no CSS engine.

---

### Task 22: Icon, breadcrumb, MatchQuality and alt-text semantics

Closes **L24**, **L25**, **L26**, **L27**.

**Files:**
- Modify: every `@remixicon/react` usage without `aria-hidden`
- Modify: `src/components/categories/CategoryBreadcrumb.tsx`
- Modify: `src/components/listings/MatchQuality.tsx`
- Modify: the `alt` attributes using database ids
- Test: `src/components/categories/CategoryBreadcrumb.component.test.tsx`, `src/components/listings/MatchQuality.component.test.tsx` (both exist — append)

**Background.**
- **L24** — icons from `@remixicon/react` ship without `aria-hidden`; only four call sites add it. An icon beside a text label is read twice.
- **L25** — breadcrumbs are spans rather than a list, so a screen reader gets no count and no structure.
- **L26** — `MatchQuality` puts its only quantitative content in a `title` attribute on a **non-focusable span**, so it is unreachable by keyboard and unread by most screen readers.
- **L27** — alt text uses database ids: `alt={`Listing photo ${image.id}`}` tells a blind user "Listing photo 4162", which is worse than nothing.

- [ ] **Step 1: Write the failing tests**

```tsx
// CategoryBreadcrumb.component.test.tsx
it("L25 — exposes the trail as a navigable list", () => {
  renderBreadcrumb(["Electronics", "Phones"]);
  const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
  expect(within(nav).getByRole("list")).toBeInTheDocument();
  expect(within(nav).getAllByRole("listitem")).toHaveLength(2);
});

// MatchQuality.component.test.tsx
it("L26 — puts the score in the accessible name, not a title attribute", () => {
  render(<MatchQuality score={0.82} />);
  // A title on a non-focusable span is unreachable by keyboard and unread by most
  // screen readers.
  expect(screen.getByRole("img", { name: /82% match/i })).toBeInTheDocument();
});
```

For L27, in `ImageUploader.component.test.tsx`:

```tsx
it("L27 — describes saved photos by position, not by database id", () => {
  render(<ImageUploader files={[]} existing={[{ id: 4162 }, { id: 4163 }]} onFilesChange={vi.fn()} onRemoveExisting={vi.fn()} />);
  expect(screen.getByAltText("Listing photo 1 of 2")).toBeInTheDocument();
  expect(screen.queryByAltText(/4162/)).toBeNull();
});
```

- [ ] **Step 2: Run them to verify they fail**

Expected: FAIL on all three.

- [ ] **Step 3: Implement — icons**

Run `grep -rn "from \"@remixicon/react\"" src --include=*.tsx | grep -v "\.test\."` to list the files, then add `aria-hidden="true"` to every icon element that sits beside a text label or inside an already-labelled control. An icon that is the *only* content of a control keeps its label on the control (e.g. `Modal`'s close button already has `aria-label="Close modal"`, so its icon becomes `aria-hidden`).

Where an icon carries meaning on its own with no adjacent text, give the **parent** an accessible name rather than labelling the icon.

- [ ] **Step 4: Implement — breadcrumbs**

```tsx
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {trail.map((entry, index) => (
          <li key={entry.id} className="flex items-center gap-1">
            {index > 0 && (
              /* Decorative separator, not content — contrast-exempt. */
              <span className="text-zinc-300" aria-hidden="true">›</span>
            )}
            {/* existing link or text for `entry` */}
          </li>
        ))}
      </ol>
    </nav>
```

Match the existing markup for the entry itself; only the wrapper structure changes.

- [ ] **Step 5: Implement — MatchQuality**

Replace the `title` attribute with a labelled `role="img"`, the same pattern `StarRating` already uses well:

```tsx
    <span
      role="img"
      aria-label={`${Math.round(score * 100)}% match`}
      className={/* existing classes */}
    >
      <span aria-hidden="true">{/* existing visual content */}</span>
    </span>
```

Delete the `title` attribute — keeping both would read the value twice.

- [ ] **Step 6: Implement — alt text**

In `ImageUploader.tsx`, the existing-image `alt` becomes positional:

```tsx
          {existing.map((image, index) => (
            <li key={`existing-${image.id}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/images/${image.id}`}
                alt={`Listing photo ${index + 1} of ${existing.length}`}
```

Run `grep -rn "alt={" src --include=*.tsx | grep -v "\.test\."` and fix any other alt built from an id the same way. Where the listing title is available, prefer it — `alt={listing.title}` is better than a position.

- [ ] **Step 7: Run the tests, then deliberate break**

Run: `npm test -- --project component`

Break: restore the `title` attribute on `MatchQuality` and remove the `aria-label`.
Run `-t "not a title attribute"` → FAIL. Restore.

- [ ] **Step 8: Commit**

```bash
git add src/components
git commit -m "fix(a11y): icon, breadcrumb, MatchQuality and alt-text semantics (L24-L27)"
```

---

## Wave 3 gate

Controller runs, backgrounded: `npm test`, `npm run build`, `npx tsc --noEmit`, `npm run lint`. All clean before wave 4.

---

# Wave 4 — Architecture

One decision with three consequences. The client pages stay exactly as they are; what changes is what surrounds them.

---

### Task 23: `error.tsx`, `not-found.tsx`, `global-error.tsx`

Closes **H1**.

**Files:**
- Create: `src/app/(frontend)/error.tsx`, `src/app/(frontend)/not-found.tsx`, `src/app/global-error.tsx`
- Test: `src/app/(frontend)/error.component.test.tsx`, `src/app/(frontend)/not-found.component.test.tsx` (create)

**Interfaces:**
- Consumes: `EmptyState` (`{ icon, title, description?, action? }`), `Button`.
- Produces: nothing.

**Background.** There is no `error.tsx`, `not-found.tsx`, `global-error.tsx` or `loading.tsx` anywhere under `src/app`. Every page is a client component, so any thrown exception unwinds to the root and replaces the whole document with Next's bare "Application error: a client-side exception has occurred" — no navbar, no footer, no link back. A mistyped URL gets the framework default 404, equally chrome-less.

**The one thing people get wrong here:** `global-error.tsx` **replaces the root layout**, so it must render its own `<html>` and `<body>` and cannot use any app chrome, fonts or providers. Keep it deliberately plain and dependency-free.

- [ ] **Step 1: Write the failing tests**

`src/app/(frontend)/error.component.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ErrorBoundaryPage from "./error";

describe("H1 — a thrown render recovers instead of whiting out", () => {
  it("offers a way to retry", async () => {
    const reset = vi.fn();
    render(<ErrorBoundaryPage error={new Error("boom")} reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("offers a way back to the marketplace", () => {
    render(<ErrorBoundaryPage error={new Error("boom")} reset={vi.fn()} />);
    expect(screen.getByRole("link", { name: /browse listings/i })).toHaveAttribute(
      "href",
      "/listings",
    );
  });

  it("does not put the raw error message on the page", () => {
    // Stack traces and internal messages are not user-facing copy.
    render(<ErrorBoundaryPage error={new Error("ECONNREFUSED 10.0.0.4:5432")} reset={vi.fn()} />);
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
  });
});
```

`src/app/(frontend)/not-found.component.test.tsx`:

```tsx
import NotFound from "./not-found";

describe("H1 — a mistyped URL keeps the app's chrome", () => {
  it("explains and offers a way on", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse listings/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --project component "src/app/(frontend)"`

Expected: FAIL — neither module exists.

- [ ] **Step 3: Implement `error.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RiErrorWarningLine } from "@remixicon/react";

import { Button, EmptyState } from "@/components/ui";

/**
 * Segment error boundary.
 *
 * Every page under (frontend) is a client component, so a render-time throw used to
 * unwind to the root and replace the whole document with Next's bare "Application
 * error" screen — no navbar, no footer, no link back. This keeps the app's chrome and
 * offers both a retry and a way on.
 */
export default function ErrorBoundaryPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what correlates this with the server log; the message itself is
    // not user-facing copy.
    console.error("Unhandled render error", error.digest ?? error);
  }, [error]);

  return (
    <EmptyState
      icon={<RiErrorWarningLine size={28} aria-hidden="true" />}
      title="Something went wrong"
      description="The page could not be displayed. Trying again often works; if it does not, head back to the marketplace."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Link href="/listings">
            <Button variant="secondary">Browse listings</Button>
          </Link>
        </div>
      }
    />
  );
}
```

If `EmptyState` is not exported from the `ui` barrel, import it directly — `ui/` is the one barrel with importers, so prefer it if it already exports both.

- [ ] **Step 4: Implement `not-found.tsx`**

```tsx
import Link from "next/link";
import { RiCompass3Line } from "@remixicon/react";

import { Button, EmptyState } from "@/components/ui";

/** 404 inside the app shell, rather than the framework's chrome-less default. */
export default function NotFound() {
  return (
    <EmptyState
      icon={<RiCompass3Line size={28} aria-hidden="true" />}
      title="Page not found"
      description="That link does not lead anywhere. It may have been removed, or the address may be mistyped."
      action={
        <Link href="/listings">
          <Button>Browse listings</Button>
        </Link>
      }
    />
  );
}
```

`EmptyState` renders a `<p>` for its title. The test asserts a heading — change `EmptyState`'s title element to an `<h2>` styled identically, which is the correct semantic for a section placeholder and improves every other use of it too. If you would rather not touch the shared component, render the heading in these two files instead and note the choice in your report.

- [ ] **Step 5: Implement `global-error.tsx`**

```tsx
"use client";

/**
 * Last-resort boundary: a throw in the root layout itself.
 *
 * This REPLACES the root layout, so it must render its own <html> and <body> and
 * cannot use the app's fonts, providers or components — none of them are mounted.
 * Deliberately plain and dependency-free.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f8f9fc",
          color: "#111827",
        }}
      >
        <main style={{ maxWidth: "32rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            C2C Market is temporarily unavailable
          </h1>
          <p style={{ color: "#4b5563", marginBottom: "1.5rem" }}>
            Something went wrong while loading the application.
          </p>
          <button
            onClick={reset}
            style={{
              border: 0,
              borderRadius: "0.5rem",
              background: "#4f46e5",
              color: "#fff",
              padding: "0.5rem 1.25rem",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#6b7280" }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Run the tests and the build**

Run: `npm test -- --project component "src/app/(frontend)"` → PASS.
Run: `npm run build` → all routes still generate. Next reports the new special files in the route list.

- [ ] **Step 7: Deliberate break**

Delete the `<Button onClick={reset}>` from `error.tsx`.

Run: `npm test -- --project component "src/app/(frontend)/error.component.test.tsx" -t "offers a way to retry"`

Expected: FAIL. Restore.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(frontend)/error.tsx" "src/app/(frontend)/not-found.tsx" src/app/global-error.tsx "src/app/(frontend)/error.component.test.tsx" "src/app/(frontend)/not-found.component.test.tsx" src/components/ui
git commit -m "feat(fe): error boundary, 404 and global error pages (H1)"
```

Body: no App Router special files existed at all, so every unhandled throw replaced the document with Next's chrome-less default. Notes that `global-error.tsx` replaces the root layout and therefore renders its own `<html>`/`<body>` with no app dependencies.

---

### Task 24: Server segment layouts carrying metadata

Closes the architectural item. Spec D8, D10.

**Files:**
- Create: `src/lib/listing-metadata.ts`, `src/lib/listing-metadata.integration.test.ts`
- Create: `layout.tsx` in each segment listed below
- Delete: the two inert `_metadata` exports (`listings/page.tsx:21`, `login/page.tsx:18`)

**Interfaces:**
- Consumes: `isPubliclyVisible` from `@/lib/listing-visibility`, drizzle from `@/db`.
- Produces: `export async function listingForMetadata(id: number): Promise<{ title: string; description: string } | null>` — returns `null` for a listing that is not publicly visible **or** does not exist. Task 25 uses the same module's `activeListingsForSitemap`.

**Background.** Thirteen of the fifteen pages under `(frontend)` carry `"use client"`. A client component cannot export `metadata`, so both layouts define `title.template: "%s | C2C Market"` and **nothing ever supplies the `%s`**. Every listing and every seller profile ships the bare title "C2C Market". `login/page.tsx:16` documents this honestly by renaming its export to `_metadata`; `listings/page.tsx:21` does the same silently and just looks like a bug.

The fix is not "rewrite as server components". It is a small server `layout.tsx` per route segment carrying the metadata. The client pages stay exactly as they are.

**Spec D10 — the boundary this crosses.** These layouts are the first place `src/app/(frontend)` imports from `src/db`. Only server files may do this. A client component importing drizzle fails to compile, so the boundary enforces itself, but say so in the code.

- [ ] **Step 1: Write the failing integration test**

Create `src/lib/listing-metadata.integration.test.ts`:

```ts
/**
 * generateMetadata resolves as anonymous (spec D8): it applies isPubliclyVisible and
 * nothing else. A draft must never leak its title into a <meta> tag or a link preview,
 * and reading the session here would make the served HTML vary by cookie.
 *
 * This is a security boundary, so it is tested against a real database like the API's
 * boundaries are.
 */
import { describe, expect, it } from "vitest";

import { listingForMetadata } from "./listing-metadata";
// Reuse the existing integration harness helpers for seeding.

describe("listingForMetadata", () => {
  it("returns the real title for an active listing", async () => {
    const id = await seedListing({ title: "Blue bicycle", status: "active" });
    await expect(listingForMetadata(id)).resolves.toMatchObject({
      title: "Blue bicycle",
    });
  });

  it("still returns it for reserved and sold, which are publicly readable", async () => {
    for (const status of ["reserved", "sold"] as const) {
      const id = await seedListing({ title: `A ${status} thing`, status });
      await expect(listingForMetadata(id)).resolves.not.toBeNull();
    }
  });

  it("refuses to leak a draft's title", async () => {
    const id = await seedListing({ title: "Secret unpublished thing", status: "draft" });
    await expect(listingForMetadata(id)).resolves.toBeNull();
  });

  it("returns null for a listing that does not exist", async () => {
    await expect(listingForMetadata(999_999_999)).resolves.toBeNull();
  });
});
```

Use whatever seeding helper the existing integration tests use; do not invent a new harness.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --project integration src/lib/listing-metadata.integration.test.ts`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the server read**

Create `src/lib/listing-metadata.ts`:

```ts
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { isPubliclyVisible } from "@/lib/listing-visibility";

/**
 * The fields `generateMetadata` needs for one listing, or null if it must not be shown.
 *
 * Resolves as ANONYMOUS on purpose (spec D8). Reading the session would make the served
 * HTML vary by cookie — a caching hazard — and risks putting a draft's title into a
 * <meta> tag or a link preview. `reserved` and `sold` are publicly readable, so a
 * shared link to a completed sale still previews correctly.
 *
 * Server-only. This is the frontend's single door into the database (spec D10); no
 * client component may import it, and one that tried would fail to compile.
 */
export async function listingForMetadata(
  id: number,
): Promise<{ title: string; description: string } | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

  const [row] = await db
    .select({
      title: listings.title,
      description: listings.description,
      status: listings.status,
    })
    .from(listings)
    .where(eq(listings.id, id))
    .limit(1);

  if (!row || !isPubliclyVisible(row.status)) return null;

  return { title: row.title, description: row.description };
}
```

- [ ] **Step 4: Implement the dynamic layouts**

`src/app/(frontend)/listings/[id]/layout.tsx`:

```tsx
import type { Metadata } from "next";

import { listingForMetadata } from "@/lib/listing-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await listingForMetadata(Number(id));

  if (!listing) {
    // Not publicly visible, or not there. Generic title, and keep it out of the index.
    return { title: "Listing", robots: { index: false } };
  }

  return {
    title: listing.title,
    description: listing.description.slice(0, 160),
    openGraph: {
      title: listing.title,
      description: listing.description.slice(0, 160),
    },
  };
}

/** Metadata carrier only — the page below stays a client component. */
export default function ListingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

`src/app/(frontend)/users/[id]/layout.tsx` follows the same shape. A seller profile is public, so it needs a name lookup rather than the listing helper — add `sellerForMetadata(id)` to `listing-metadata.ts` returning `{ name }` or `null`, and give it its own case in the integration test.

- [ ] **Step 5: Implement the static layouts**

Create a `layout.tsx` in each of these segments with the same two-line body and the metadata shown:

| Segment | `title` | `robots` |
| --- | --- | --- |
| `listings/` | `"Browse listings"` | — |
| `listings/new/` | `"New listing"` | `{ index: false }` |
| `listings/[id]/edit/` | `"Edit listing"` | `{ index: false }` |
| `login/` | `"Login"` | — |
| `register/` | `"Register"` | — |
| `link-account/` | `"Link account"` | `{ index: false }` |
| `settings/` | `"Settings"` | `{ index: false }` |
| `orders/` | `"Your orders"` | `{ index: false }` |
| `orders/[id]/` | `"Order"` | `{ index: false }` |
| `seller/` | `"Seller dashboard"` | `{ index: false }` |
| `api-docs/` | `"API documentation"` | — |

The shape, using `settings` as the example:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  // Behind ProtectedRoute, but a crawler reaching it would otherwise index the
  // redirect-to-login screen under a real title.
  robots: { index: false },
};

/** Metadata carrier only — the page below stays a client component. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

Note that `listings/layout.tsx` also wraps `listings/[id]` and `listings/new`; those segments' own layouts override it, which is the intended nesting.

- [ ] **Step 6: Delete the two inert exports**

Remove `export const _metadata` from `src/app/(frontend)/listings/page.tsx:21` and `src/app/(frontend)/login/page.tsx:18`, together with the comments explaining why they were renamed — the explanation no longer applies. **This is the ordering hazard in spec §6:** do this only now that the layouts exist.

- [ ] **Step 7: Verify the titles actually resolve**

Run: `npm run build` — every route generates.

Then confirm the template is being supplied. Add to `src/lib/listing-metadata.integration.test.ts` or a small unit test:

```ts
it("supplies the %s that title.template was waiting for", async () => {
  const { metadata } = await import("@/app/(frontend)/settings/layout");
  expect(metadata.title).toBe("Settings");
});
```

- [ ] **Step 8: Run the tests, then deliberate break**

Run: `npm test -- --project integration src/lib/listing-metadata.integration.test.ts` → PASS.

Break: change `if (!row || !isPubliclyVisible(row.status)) return null;` to `if (!row) return null;`.
Run `-t "refuses to leak a draft"` → FAIL. Restore.

- [ ] **Step 9: Commit**

```bash
git add src/lib/listing-metadata.ts src/lib/listing-metadata.integration.test.ts "src/app/(frontend)"
git commit -m "feat(fe): server segment layouts supply the metadata client pages cannot"
```

Body: thirteen of fifteen pages are client components, so `title.template: "%s | C2C Market"` never received a `%s` and every listing shipped the bare title "C2C Market"; the two `_metadata` exports were the workaround and are now deleted. `generateMetadata` resolves as anonymous (D8) so a draft cannot leak its title, proved by integration test. Records that this is the frontend's first direct `src/db` import (D10) and that only server files may do it.

---

### Task 25: `sitemap.ts` and `robots.ts`

Closes the last third of the architectural item. Spec D9.

**Files:**
- Create: `src/app/sitemap.ts`, `src/app/robots.ts`
- Modify: `src/lib/listing-metadata.ts` (add the sitemap query), `.env.example`
- Test: `src/app/sitemap.integration.test.ts` (create)

**Interfaces:**
- Consumes: `listingForMetadata`'s module.
- Produces: `export async function activeListingsForSitemap(limit: number): Promise<Array<{ id: number; updatedAt: Date }>>`.

**Background.** Listing content is never server-rendered and there is no `sitemap.ts` and no `robots.ts`. For a marketplace, the listing pages are precisely the ones that need to be indexable.

**Spec D9 — the sitemap is deliberately narrower than the metadata rule.** It emits **`active` listings only**, matching what browse actually shows. A `reserved` listing is publicly readable but is not for sale, so advertising it to a crawler produces a bad result page. Seller profiles are excluded despite being public — thin pages, and including them doubles the query surface for little indexing value.

**Base URL.** `OAUTH_REDIRECT_BASE_URL` already holds this app's public origin, taken from config rather than the `Host` header precisely because that header is attacker-controlled. Reuse it rather than adding a second copy of the same value: read `SITE_URL` if set, otherwise fall back to `OAUTH_REDIRECT_BASE_URL`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

describe("D9 — the sitemap advertises only what is for sale", () => {
  it("includes an active listing", async () => {
    const id = await seedListing({ status: "active" });
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toContain(expect.stringContaining(`/listings/${id}`));
  });

  it("excludes reserved and sold listings, which are readable but not for sale", async () => {
    const reserved = await seedListing({ status: "reserved" });
    const sold = await seedListing({ status: "sold" });
    const urls = (await sitemap()).map((e) => e.url).join(" ");
    expect(urls).not.toContain(`/listings/${reserved}`);
    expect(urls).not.toContain(`/listings/${sold}`);
  });

  it("excludes drafts", async () => {
    const draft = await seedListing({ status: "draft" });
    expect((await sitemap()).map((e) => e.url).join(" ")).not.toContain(`/listings/${draft}`);
  });

  it("includes the public static routes", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/listings"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/orders"))).toBe(false);
  });
});

describe("robots", () => {
  it("keeps crawlers out of the API and the private segments", () => {
    const { rules } = robots();
    const disallow = Array.isArray(rules) ? rules[0].disallow : rules.disallow;
    expect(disallow).toEqual(
      expect.arrayContaining(["/api/", "/orders", "/settings", "/seller"]),
    );
  });

  it("points at the sitemap", () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --project integration src/app/sitemap.integration.test.ts`

Expected: FAIL — neither module exists.

- [ ] **Step 3: Implement the query**

Append to `src/lib/listing-metadata.ts`:

```ts
/**
 * Listings the sitemap should advertise.
 *
 * `active` only, deliberately narrower than `listingForMetadata`'s rule (spec D9):
 * a reserved or sold listing is publicly readable, but it is not for sale, so pointing
 * a crawler at it produces a bad result page.
 *
 * Capped because a Next sitemap holds at most 50,000 URLs. If the catalogue ever
 * approaches that, split it with `generateSitemaps` rather than raising this.
 */
export async function activeListingsForSitemap(
  limit = 10_000,
): Promise<Array<{ id: number; updatedAt: Date }>> {
  return db
    .select({ id: listings.id, updatedAt: listings.updatedAt })
    .from(listings)
    .where(eq(listings.status, "active"))
    .orderBy(desc(listings.updatedAt))
    .limit(limit);
}
```

Import `desc` from `drizzle-orm`. If the column is named differently from `updatedAt`, use the real name and adjust the return type.

- [ ] **Step 4: Implement the base URL helper**

Create `src/lib/site-url.ts`:

```ts
/**
 * This app's public origin, for absolute URLs in the sitemap and robots files.
 *
 * Falls back to OAUTH_REDIRECT_BASE_URL, which already holds exactly this value and is
 * read from config rather than the Host header — that header is attacker-controlled.
 * One value, configured once.
 */
export function siteUrl(): string {
  const configured = process.env.SITE_URL ?? process.env.OAUTH_REDIRECT_BASE_URL;
  return (configured ?? "http://localhost:3000").replace(/\/+$/, "");
}
```

- [ ] **Step 5: Implement `sitemap.ts` and `robots.ts`**

```ts
// src/app/sitemap.ts
import type { MetadataRoute } from "next";

import { activeListingsForSitemap } from "@/lib/listing-metadata";
import { siteUrl } from "@/lib/site-url";

/** Public routes worth indexing. Everything behind ProtectedRoute is omitted. */
const PUBLIC_ROUTES = ["", "/listings", "/login", "/register", "/api-docs"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const listings = await activeListingsForSitemap();

  return [
    ...PUBLIC_ROUTES.map((path) => ({
      url: `${base}${path}`,
      changeFrequency: "daily" as const,
      priority: path === "/listings" ? 1 : 0.5,
    })),
    ...listings.map((listing) => ({
      url: `${base}/listings/${listing.id}`,
      lastModified: listing.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
```

```ts
// src/app/robots.ts
import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The same segments that carry robots: { index: false } in their layouts.
        disallow: [
          "/api/",
          "/orders",
          "/settings",
          "/seller",
          "/listings/new",
          "/link-account",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
```

- [ ] **Step 6: Document the variable**

Append to `.env.example`:

```
# Public origin used for absolute URLs in sitemap.xml and robots.txt. Optional:
# falls back to OAUTH_REDIRECT_BASE_URL, which is the same value. Set it only if the
# crawler-facing origin differs from the OAuth callback origin.
# SITE_URL=https://c2c.example
```

- [ ] **Step 7: Run the tests and the build**

Run: `npm test -- --project integration src/app/sitemap.integration.test.ts` → PASS.
Run: `npm run build` → the route list now shows `/sitemap.xml` and `/robots.txt`.

- [ ] **Step 8: Deliberate break**

Change the sitemap query's `eq(listings.status, "active")` to include `reserved`.

Run `-t "excludes reserved and sold"` → FAIL. Restore.

- [ ] **Step 9: Commit**

```bash
git add src/app/sitemap.ts src/app/robots.ts src/lib/listing-metadata.ts src/lib/site-url.ts src/app/sitemap.integration.test.ts .env.example
git commit -m "feat(fe): sitemap and robots for the public marketplace"
```

Body: for a marketplace the listing pages are exactly the ones that need indexing, and there was no sitemap or robots file at all. Records D9's narrower rule — `active` only, because a reserved listing is readable but not for sale — that seller profiles are deliberately excluded, and that the base URL reuses `OAUTH_REDIRECT_BASE_URL` rather than duplicating the same origin in a second variable.

---

## Wave 4 gate

Controller runs, backgrounded: `npm test`, `npm run build`, `npx tsc --noEmit`, `npm run lint`. Confirm the build output lists `/sitemap.xml` and `/robots.txt`, and spot-check that a listing page's `<title>` is now the listing's own title rather than "C2C Market".

---

# Wave 5 — Tests, types, dead code, polish

---

### Task 26: Test `ProtectedRoute`, and role-gate `/seller`

Closes **H11** and **L17**.

**Files:**
- Create: `src/components/ProtectedRoute.component.test.tsx` (or extend it if Task 11 created it)
- Modify: `src/app/(frontend)/seller/page.tsx`

**Background.** `ProtectedRoute` is the client-side auth and role gate, with 6 call sites, all themselves untested. Change `if (!isAuthenticated || !roleAllowed) return null;` at `:94` to `if (loading) return null;` and every protected page renders its content to an anonymous visitor while the redirect is in flight — **with the whole suite still green**. Flip `!allowedRoles` to `allowedRoles` at `:66-67` and buyers get the seller listing form. Nothing fails.

The only automated proof a buyer cannot reach `/listings/new` lives in the API's RBAC integration tests. The UI half of that guarantee is unverified.

Separately (**L17**), `/seller` is not role-gated at all, so a buyer reaches a dead-end dashboard.

- [ ] **Step 1: Write the failing tests**

```tsx
describe("H11 — ProtectedRoute is the client-side gate", () => {
  it("renders nothing to an anonymous visitor while the redirect is in flight", () => {
    mockAuth({ isAuthenticated: false, loading: false });
    render(<ProtectedRoute><p>secret</p></ProtectedRoute>);
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("shows the fallback while the session is still being checked", () => {
    mockAuth({ isAuthenticated: false, loading: true });
    render(<ProtectedRoute><p>secret</p></ProtectedRoute>);
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.getByText(/checking authentication/i)).toBeInTheDocument();
  });

  it("renders the content to an authenticated user", () => {
    mockAuth({ isAuthenticated: true, loading: false, user: { id: 1, role: "buyer" } });
    render(<ProtectedRoute><p>secret</p></ProtectedRoute>);
    expect(screen.getByText("secret")).toBeInTheDocument();
  });

  it("keeps a buyer out of a seller-only route", () => {
    mockAuth({ isAuthenticated: true, loading: false, user: { id: 1, role: "buyer" } });
    render(
      <ProtectedRoute allowedRoles={["seller"]}><p>seller form</p></ProtectedRoute>,
    );
    // The API's RBAC tests prove the endpoint refuses. This is the UI half.
    expect(screen.queryByText("seller form")).toBeNull();
    expect(replaceSpy).toHaveBeenCalledWith("/");
  });

  it("lets a seller into a seller-only route", () => {
    mockAuth({ isAuthenticated: true, loading: false, user: { id: 2, role: "seller" } });
    render(
      <ProtectedRoute allowedRoles={["seller"]}><p>seller form</p></ProtectedRoute>,
    );
    expect(screen.getByText("seller form")).toBeInTheDocument();
  });

  it("lets an unrestricted route through for any role", () => {
    mockAuth({ isAuthenticated: true, loading: false, user: { id: 1, role: "buyer" } });
    render(<ProtectedRoute><p>anyone</p></ProtectedRoute>);
    expect(screen.getByText("anyone")).toBeInTheDocument();
  });
});

describe("L17 — /seller is seller-only", () => {
  it("does not show a buyer the dashboard", () => {
    mockAuth({ isAuthenticated: true, loading: false, user: { id: 1, role: "buyer" } });
    renderSellerPage();
    expect(screen.queryByRole("heading", { name: /seller dashboard/i })).toBeNull();
  });
});
```

`mockAuth` mocks `@/context/AuthContext`'s `useAuth`; `replaceSpy` is `router.replace` from a mocked `next/navigation`. Follow the mocking idiom already used in `AuthContext.component.test.tsx`.

- [ ] **Step 2: Run them to verify they fail**

Expected: the `ProtectedRoute` tests should mostly **pass** — the component is correct today; these are the missing proofs. The `/seller` test **fails**, because the page has no role gate.

This is the one task where most tests pass on first run. That is expected and is exactly why the deliberate break in Step 4 is the real verification here.

- [ ] **Step 3: Implement the `/seller` gate**

Wrap the page's export:

```tsx
export default function SellerDashboardPage() {
  return (
    <ProtectedRoute allowedRoles={["seller", "admin"]}>
      <SellerDashboardContent />
    </ProtectedRoute>
  );
}
```

Check whether the page already has a `ProtectedRoute` wrapper without `allowedRoles`; if so, just add the prop.

- [ ] **Step 4: Deliberate break — twice, because this is the point of the task**

(a) Change `:94` from `if (!isAuthenticated || !roleAllowed) return null;` to `if (loading) return null;`.
Run: `npm test -- --project component src/components/ProtectedRoute.component.test.tsx`
Expected: FAIL on "renders nothing to an anonymous visitor" and "keeps a buyer out". Restore.

(b) Change `:66-67` from `!allowedRoles ||` to `allowedRoles &&`.
Run the same file.
Expected: FAIL on "lets an unrestricted route through". Restore.

Both breaks previously left the suite green. Record both in your report.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtectedRoute.component.test.tsx "src/app/(frontend)/seller/page.tsx"
git commit -m "test(fe): cover ProtectedRoute; role-gate /seller (H11, L17)"
```

---

### Task 27: Test `Modal`, `StatusBadge` and `Button`

Closes **H13**.

**Files:**
- Create: `src/components/ui/StatusBadge.component.test.tsx`
- `Modal` and `Button` were covered by Tasks 4 and 2 — extend rather than duplicate

**Background.** Most `ui/` primitives are thin enough not to matter. Three are not. `Modal` owns an Escape listener and a `document.body.style.overflow` lock — a global side effect on a shared node; if its cleanup regressed the page would be permanently unscrollable after closing a dialog. `StatusBadge` owns every buyer-facing status word in the app. `Button`'s `disabled || loading` is the mechanism the double-submit tests rely on, tested only incidentally through them. `Button` alone has 37 usages: a regression there is 37 regressions.

- [ ] **Step 1: Confirm what Tasks 2 and 4 already cover**

Run: `npm test -- --project component src/components/ui/Button.component.test.tsx src/components/ui/Modal.component.test.tsx`

Both should exist and pass. `Modal`'s scroll-lock release and `Button`'s `disabled || loading` are already pinned. Do not duplicate them; note in your report that H13's Modal and Button halves were satisfied in wave 1.

- [ ] **Step 2: Write the failing StatusBadge test**

```tsx
/**
 * StatusBadge owns every buyer-facing status word in the app, and `status` is typed
 * `string` then cast into two typed maps — so `status="sold"` without `kind="listing"`
 * silently renders grey with no error anywhere. (L8 fixes the type in Task 29; this
 * pins the behaviour first.)
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import StatusBadge from "./StatusBadge";

const ORDER_STATUSES = [
  "pending", "confirmed", "shipped", "completed", "cancelled", "declined", "expired",
] as const;

const LISTING_STATUSES = ["draft", "active", "reserved", "sold"] as const;

describe("StatusBadge", () => {
  // `getByText(/\w/)` would pass for any non-empty string, including a status the
  // map does not know. Assert the badge renders a label that is not the raw enum
  // value, which is what a missing map entry would leave behind.
  it.each(ORDER_STATUSES)("gives the order status %s a human label", (status) => {
    render(<StatusBadge status={status} kind="order" />);
    const label = screen.getByText(/\S/).textContent?.trim() ?? "";
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe(status);
  });

  it.each(LISTING_STATUSES)("gives the listing status %s a human label", (status) => {
    render(<StatusBadge status={status} kind="listing" />);
    const label = screen.getByText(/\S/).textContent?.trim() ?? "";
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe(status);
  });

  it("gives each status a distinguishable label, not just a colour", () => {
    const labels = new Set(
      ORDER_STATUSES.map((status) => {
        const { unmount } = render(<StatusBadge status={status} kind="order" />);
        const text = screen.getByText(/\S/).textContent;
        unmount();
        return text;
      }),
    );
    expect(labels.size).toBe(ORDER_STATUSES.length);
  });
});
```

Adjust the status lists to the real enums in `src/lib/order-lifecycle.ts` and `src/db/schema/listings.ts` — do not invent values.

- [ ] **Step 3: Run, implement any gaps, then deliberate break**

Run the file. If a status has no entry in the map it will render blank or grey — that is a real finding; add the missing entry.

Break: delete one status's entry from the map.
Run `-t "distinguishable label"` → FAIL. Restore.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/StatusBadge.component.test.tsx src/components/ui/StatusBadge.tsx
git commit -m "test(fe): cover StatusBadge, the owner of every status word (H13)"
```

---

### Task 28: Repair the tests that cannot fail, and measure the frontend

Closes **L12**, **L13**, **L14**, **L15**.

**Files:**
- Modify: the test asserting `/flex/`, the vacuous conditional assertion, the three files with `act()` warnings
- Modify: `vitest.config.ts:69`

**Background.**
- **L12** — one test asserts `/flex/` against a class list containing both `flex` and `min-w-0`. It cannot fail for the regression its own comment describes.
- **L13** — one conditional assertion passes vacuously if the icon it checks is removed.
- **L14** — `act()` warnings in three files, all from correctly testing an in-flight state.
- **L15** — `coverage.include` is `["src/lib/**", "src/app/api/**"]`, so the entire frontend is excluded from measurement.

- [ ] **Step 1: Find them**

Run: `grep -rn "/flex/" src --include=*.test.tsx`
Run: `npm test -- --project component 2>&1 | grep -i "not wrapped in act"`

Record the exact files and lines in your report before changing anything.

- [ ] **Step 2: Fix L12 — make the assertion able to fail**

The comment describes a specific regression. Assert the class the regression would remove, exactly:

```tsx
// `toMatch(/flex/)` also matched `min-w-0` in the same class list, so this could not
// fail for the regression the comment describes.
expect(element.className.split(/\s+/)).toContain("flex");
```

- [ ] **Step 3: Fix L13 — make the conditional assertion unconditional**

Replace `if (icon) expect(icon).toHaveAttribute(...)` with a query that throws when the icon is absent:

```tsx
const icon = screen.getByTestId("…"); // or getByRole — a `get*` query throws when missing
expect(icon).toHaveAttribute("aria-hidden", "true");
```

- [ ] **Step 4: Fix L14 — the act warnings**

These come from correctly testing an in-flight state: the component updates after an await that the test does not await. Wrap the assertion in `await waitFor(...)`, or await the settling promise, rather than silencing the warning. Do **not** set `global.IS_REACT_ACT_ENVIRONMENT` or wrap in bare `act()` to hide it.

- [ ] **Step 5: Fix L15 — measure the frontend**

`vitest.config.ts:69`:

```ts
      include: [
        "src/lib/**",
        "src/app/api/**",
        // The frontend was excluded from measurement entirely, so a component with no
        // tests looked identical to one with full coverage.
        "src/app/(frontend)/**",
        "src/components/**",
        "src/hooks/**",
        "src/context/**",
      ],
```

Leave the `exclude` list and the deliberate absence of thresholds alone — the existing comment defers those to a measured baseline, and this pass is not the place to set them.

- [ ] **Step 6: Verify**

Run: `npm test -- --project component` → PASS, and **no `act()` warnings** in the output.
Run: `npm run test:coverage` (or `npm test -- --coverage`) → the report now lists frontend files.

- [ ] **Step 7: Deliberate break**

Remove the class the L12 assertion now checks from the component under test.
Run that test → FAIL, which it could not do before. Restore.

- [ ] **Step 8: Commit**

```bash
git add src vitest.config.ts
git commit -m "test(fe): repair assertions that could not fail; measure the frontend (L12-L15)"
```

---

### Task 29: Types that were casts

Closes **L8**, **L9**, **L10**.

**Files:**
- Modify: `src/components/ui/StatusBadge.tsx`, `src/app/(frontend)/listings/page.tsx`, `src/components/CurrencySelect.tsx`

**Background.**
- **L8** — `StatusBadge.status` is typed `string` then cast into two typed maps, so `status="sold"` without `kind="listing"` silently renders grey.
- **L9** — `sort` is cast rather than validated at `listings/page.tsx:48-50`, so `?sort=oldest` gives a dropdown reading "Newest" over oldest-first results.
- **L10** — `CurrencySelect` takes `ReturnType<typeof useCurrencyConversion>` as a prop, which couples it to the hook's implementation rather than to an interface.

- [ ] **Step 1: Write the failing tests**

```tsx
// listings/page.component.test.tsx
it("L9 — falls back to the default sort for an unknown value in the URL", async () => {
  renderPage({ searchParams: "sort=oldest" });
  // Previously cast, so the dropdown read "Newest" while the query asked for oldest.
  expect(await screen.findByLabelText(/sort/i)).toHaveValue("newest");
  await waitFor(() => expect(lastQuery()).toContain("sort=newest"));
});
```

For L8 the proof is a compile error, not a runtime test. Add a type-level assertion in `StatusBadge.component.test.tsx`:

```tsx
it("L8 — a listing status is not accepted as an order status", () => {
  // @ts-expect-error "sold" is a listing status; kind="order" must reject it.
  render(<StatusBadge status="sold" kind="order" />);
});
```

`@ts-expect-error` fails the build if the error stops occurring, which makes it a real assertion.

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsc --noEmit` → the `@ts-expect-error` is reported as *unused*, which is the failure.
Run the page test → FAIL, the dropdown shows the raw value.

- [ ] **Step 3: Implement — StatusBadge**

Make `status` a discriminated union keyed on `kind`:

```tsx
export type StatusBadgeProps =
  | { kind: "order"; status: OrderStatus; size?: Size }
  | { kind: "listing"; status: ListingStatus; size?: Size };
```

Import the two status types from `@/lib/order-lifecycle` and `@/db/schema` rather than restating them. Remove the internal casts — with the union in place the maps index safely.

- [ ] **Step 4: Implement — sort validation**

```tsx
const SORT_OPTIONS = ["newest", "price_asc", "price_desc"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

function parseSort(raw: string | null): SortOption {
  // Cast, previously: `?sort=oldest` produced a dropdown reading "Newest" over
  // results the server sorted some other way.
  return (SORT_OPTIONS as readonly string[]).includes(raw ?? "")
    ? (raw as SortOption)
    : "newest";
}
```

Use `parseSort(searchParams.get("sort"))` in the initial state.

- [ ] **Step 5: Implement — CurrencySelect's prop**

Declare the interface the component actually needs instead of the hook's whole return type:

```tsx
export type CurrencyControl = {
  selectedCurrency: string;
  setSelectedCurrency: (currency: string) => void;
  loadingRates: boolean;
  ratesError: string | null;
  availableCurrencies: readonly string[];
};

export type CurrencySelectProps = {
  conversion: CurrencyControl;
  label?: string;
  className?: string;
};
```

`useCurrencyConversion`'s return value still satisfies it structurally, so no caller changes.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit` → clean, with the `@ts-expect-error` now justified.
Run: `npm test -- --project component` → PASS.

Break: widen `StatusBadgeProps.status` back to `string`.
Run `npx tsc --noEmit` → the `@ts-expect-error` becomes unused and fails. Restore.

```bash
git add src/components/ui/StatusBadge.tsx src/components/CurrencySelect.tsx "src/app/(frontend)/listings/page.tsx"
git commit -m "refactor(fe): replace three casts with types that hold (L8-L10)"
```

---

### Task 30: Dead code

Closes **L1** and **L2**.

**Ordering hazard (spec §6): L2 depends on Task 24.** The two inert `_metadata` exports may only be deleted once their segments have a real `generateMetadata`. Task 24 does that and deletes them as part of its own step 6. **Verify before acting:** if Task 24 is complete, L2 is already closed — record it as such and do not touch those files. If Task 24 has not run, leave the exports alone and report L2 as blocked.

**Files:**
- Delete: five barrel files with zero importers

- [ ] **Step 1: Confirm the barrels really have no importers**

```bash
for f in components listings orders reviews seller; do
  echo "== $f =="
  grep -rn "from \"@/components/$f\"\|from \"\\.\\./$f\"\|from \"\\./$f\"" src --include=*.tsx --include=*.ts | grep -v "/$f/"
done
```

Any file printing a match is **not** dead — remove it from the deletion list and say so in your report. Only `ui/` is expected to have importers, and it is not on the list.

- [ ] **Step 2: Delete and verify**

Delete only the index files that printed nothing.

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → succeeds.
Run: `npm test -- --project component` → PASS.

If any of the three fails, the barrel was not dead: restore it and report which importer was missed.

- [ ] **Step 3: Confirm L2's state**

```bash
grep -rn "_metadata" src
```

Expected: no output, because Task 24 removed both. If output appears, Task 24 is incomplete — restore nothing, and report L2 as blocked on it.

- [ ] **Step 4: Commit**

```bash
git add -A src/components
git commit -m "chore(fe): delete the barrel files nothing imports (L1)"
```

Body should record which barrels were verified dead and how, and the state of L2.

---

### Task 31: One `Navbar`, one auth shell, one email regex

Closes **L5**, **L6**, **L7**.

**Files:**
- Modify: `src/components/Navbar.tsx`
- Create: `src/components/auth/AuthPageShell.tsx`
- Modify: `src/app/(frontend)/login/page.tsx`, `register/page.tsx`, `link-account/page.tsx`
- Modify: `src/lib/validation.ts` (export the shared predicate)

**Background.**
- **L5** — `Navbar` writes its whole nav twice and the seller block four times: ~110 duplicated lines out of 281.
- **L6** — three auth pages share a copy-pasted 20-line shell.
- **L7** — a byte-identical email regex in those three pages: a **fourth** definition of "valid email", alongside `lib/validation.ts` and the API's Zod schema.

- [ ] **Step 1: Fix L7 first — it is the smallest and the highest value**

`src/lib/validation.ts` already owns the API's rule. Export a client-usable predicate from it:

```ts
/**
 * The one client-side "is this an email" check.
 *
 * There were four definitions: this file, the API's Zod schema, and a byte-identical
 * regex copy-pasted into three auth pages. Four definitions of one rule is three
 * chances for them to drift apart.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
```

Replace the inline regex in all three pages with `looksLikeEmail(email)`.

Add to `src/lib/validation.test.ts`:

```ts
describe("looksLikeEmail", () => {
  it.each(["a@b.co", "first.last@example.com"])("accepts %s", (value) => {
    expect(looksLikeEmail(value)).toBe(true);
  });

  it.each(["", "no-at-sign", "a@b", "a b@c.com", "a@b .com"])("rejects %s", (value) => {
    expect(looksLikeEmail(value)).toBe(false);
  });
});
```

Run: `npm test -- --project unit src/lib/validation.test.ts` → PASS.
Run: `grep -rn "\[^\\\\s@\]" src --include=*.tsx | grep -v "\.test\."` → no output.

- [ ] **Step 2: Fix L6 — the auth shell**

Extract the shared 20-line wrapper. Compare the three pages first and keep every difference as a prop:

```tsx
export type AuthPageShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Rendered under the form — the "already have an account?" line. */
  footer?: React.ReactNode;
};
```

Do **not** fold in anything the three pages do differently. If a difference does not reduce to a prop cleanly, leave that page alone and say so.

- [ ] **Step 3: Fix L5 — the Navbar**

The nav is written twice (desktop and mobile) and the seller block four times. Extract one `NAV_LINKS` array plus a `NavLinks` sub-component parameterised by variant:

```tsx
const NAV_LINKS: Array<{ href: string; label: string; roles?: Role[] }> = [
  { href: "/listings", label: "Browse" },
  { href: "/orders", label: "Orders" },
  { href: "/seller", label: "Seller dashboard", roles: ["seller", "admin"] },
  { href: "/listings/new", label: "New listing", roles: ["seller", "admin"] },
  { href: "/settings", label: "Settings" },
];
```

`roles` replaces the four hand-written seller conditionals. **While here, close M9** — `/settings` is currently unreachable from anywhere in the UI, and it is the sole home of the linked-accounts feature. Adding it to this array is the fix; note it in the commit.

- [ ] **Step 4: Verify**

Run: `npm test -- --project component` → PASS.
Run: `npx tsc --noEmit && npm run lint` → clean.

Add a Navbar test if none exists:

```tsx
it("M9 — links to settings, which was previously unreachable", () => {
  renderNavbar({ user: { role: "buyer" } });
  expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
});

it("L5 — offers the seller links only to sellers", () => {
  renderNavbar({ user: { role: "buyer" } });
  expect(screen.queryByRole("link", { name: /seller dashboard/i })).toBeNull();
});
```

- [ ] **Step 5: Deliberate break**

Remove the `roles` filter from `NavLinks`.
Run `-t "only to sellers"` → FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/components src/lib/validation.ts src/lib/validation.test.ts "src/app/(frontend)"
git commit -m "refactor(fe): one Navbar, one auth shell, one email regex (L5-L7, M9)"
```

---

### Task 32: Polish

Closes **L16**, **L18**–**L22**. (**M9** was closed in Task 31; **L23** in Task 10.)

**Files:** several small edits; do each as its own commit-sized change within one task.

- [ ] **Step 1: L16 — reviews get an `EmptyState`**

Reviews are the one empty collection without it. Find the reviews list (`SellerReviewFeed.tsx` / `SellerReviews.tsx`) and add `EmptyState` in the zero-results branch, matching the other three collections' wording style.

Test:

```tsx
it("L16 — shows an empty state when a seller has no reviews", async () => {
  renderSellerReviews({ reviews: [] });
  expect(await screen.findByText(/no reviews yet/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: L18 — one date format**

Run: `grep -rn "toLocaleDateString\|toLocaleString\|Intl.DateTimeFormat" src --include=*.tsx | grep -v "\.test\."`

Add `formatDate(value: string | Date): string` to `src/lib/format.ts` (created in Task 3) and adopt it everywhere. Match whichever of the two existing formats is dominant; record which you kept and why.

Test in `src/lib/format.test.ts`:

```ts
it("L18 — formats a date one way", () => {
  expect(formatDate("2026-09-01T10:30:00Z")).toBe(formatDate(new Date("2026-09-01T10:30:00Z")));
  expect(formatDate("2026-09-01T10:30:00Z")).toMatch(/2026/);
});
```

- [ ] **Step 3: L19 — one avatar seed**

The same user gets two different generated avatars from three different seeds. Run `grep -rn "avatar\|dicebear\|gravatar" src --include=*.tsx | grep -v "\.test\."`, pick one seed — the user id, which is stable and unique — and add `avatarUrl(userId: number): string` to `src/lib/format.ts`. Adopt it at all three sites.

Test: the same id yields the same URL from every call site.

- [ ] **Step 4: L20 — the pager goes above the empty state**

Pagination currently renders **below** the empty state, so a user on page 4 of an empty result sees "nothing here" with the controls that would get them back pushed off-screen. Move the pager above, or hide it entirely when there are zero results and one page. Prefer hiding it when `totalPages <= 1`.

- [ ] **Step 5: L21 — a loading state on the Swagger bundle**

`/api-docs` loads a large bundle with no loading state. Add the app's existing skeleton or a simple "Loading API documentation…" with the announcer, so the page is not blank.

- [ ] **Step 6: L22 — an unsaved-changes guard on the listing form**

`ListingForm` has none. Add a `beforeunload` handler while the form is dirty:

```tsx
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
```

`isDirty` is any of title / description / price / files differing from their initial values. Note that this covers a browser navigation only; in-app route changes would need an App Router interception, which is out of scope — record that limit in your report rather than pretending it is covered.

- [ ] **Step 7: Verify everything**

Run: `npm test -- --project component --project unit` → PASS.
Run: `npx tsc --noEmit && npm run lint` → clean.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "fix(fe): polish batch — empty state, date and avatar consistency, pager, loading, unsaved guard (L16, L18-L22)"
```

---

## Final gate

Controller runs, backgrounded:

```bash
npm test
npm run build
npx tsc --noEmit
npm run lint
```

Then a whole-branch review before merge, per `superpowers:requesting-code-review`. Expected end state: full suite green with the new tests, build succeeding with all routes plus `/sitemap.xml` and `/robots.txt`, `tsc` clean, lint at 0 errors and 0 warnings.

**Report against the spec's traceability tables (§3 and §4).** Every finding ID must be accounted for as closed, deferred with a reason, or found not to hold — the last of those being a real outcome, as H14 already demonstrated.
