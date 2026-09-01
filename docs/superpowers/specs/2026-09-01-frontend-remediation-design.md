# Frontend remediation — design

**Date:** 2026-09-01
**Branch:** `feature/frontend-remediation`, cut from `develop` @ `3707b0f`
**Source:** the frontend review published as *C2C Frontend Audit*, conducted at `develop` @ `f0c5164`
**Predecessor:** `2026-08-31-api-remediation-design.md`, merged to `develop` on 2026-09-01

---

## 1. Context and scope

The frontend review was the second half of a two-part audit. Four reviewers examined
18 pages, 40 components, 4 hooks and 22 component test files with separate lenses and
raised 30 named findings — 3 Critical, 13 High, 14 Medium — plus roughly thirty smaller
items summarised as a prose table rather than enumerated.

This pass covers **everything**: every named finding, every item in the Low table, and
the single architectural decision the review separated out from the finding list.

### 1.1 What the API pass already closed

One Critical is already fixed. The build failure — `/login` and `/link-account` calling
`useSearchParams()` with no Suspense boundary — was repaired during the API remediation
because it blocked that branch's build gate. Both wrappers are on `develop`.

Verified at the time of writing, rather than assumed:

| Review claim | State on `develop` @ `3707b0f` |
| --- | --- |
| Build fails on `/login`, `/link-account` | **Closed.** `Suspense` present in both files. |
| `Modal` has no focus management | Open. `dialogRef` declared `:29`, attached `:72`, never read. |
| No `aria-live` anywhere | Open. Zero matches for `aria-live` or `role="status"` in `src/`. |
| No `error.tsx` / `not-found.tsx` / `global-error.tsx` | Open. No App Router special files exist at all. |
| Search does not reset pagination | Open. `listings/page.tsx:126` is a bare `setSearch`. |
| Price rendering duplicated | Open. 7 files use `toFixed(2)`; 2 more render bare numbers. |
| `ButtonProps` is a closed prop list | Open. Hand-written type, no `ButtonHTMLAttributes`. |

**29 of 30 named findings remain open, 2 of them Critical.**

### 1.2 Counts after the promotion in D2

| Severity | Count | Note |
| --- | --- | --- |
| Critical | 2 | third already closed |
| High | 14 | 13 from the review + 1 promoted out of the Low table |
| Medium | 14 | unchanged — the promotion came from Low, not Medium |
| Low | 27 | enumerated from the review's prose table in §4, with the promoted item removed |
| Architectural | 1 | one decision, three consequences |

Total open: **57 findings plus the architectural item, across 32 tasks.**

---

## 2. Decisions

### D1 — Scope is everything, including the architectural item

Confirmed by the user. Not just Critical and High; the Medium accessibility batch, the
whole Low tier, and the server-layout work all land in this pass.

### D2 — The currency finding is promoted from Low to High

`useCurrencyConversion` fetches exchange rates from a third-party host on four separate
pages, uncached, with no timeout and no retry — and **on a missing rate it returns USD
amounts labelled as another currency.** The review filed this under "Waste". Silently
wrong money on a marketplace is a correctness defect, not polish. Promoted to High and
tracked as **H14**.

### D3 — Sequencing is primitives first, then consumers, then accessibility, then architecture

Rejected alternatives: strict severity order, and page-by-page.

Six findings are *about* shared primitives and at least fourteen others are consumers of
those same primitives. Measured fan-in at the time of writing:

- 37 `<Button>` usages across 19 files; 17 raw `<button>` sites
- 11 `useFetch` consumers
- 9 price-render sites
- 5 `useCurrencyConversion` consumers
- `api.ts` sits under every mutation in the app

Fixing consumers first means opening those 19 files twice. Strict severity order would
also split `api.ts` across three waves and would schedule the `aria-live` Critical
*before* the announcer primitive it depends on. Page-by-page gives the best diff locality
but amends each primitive five or six times and never produces a commit in which a
primitive is right.

Both remaining Criticals are themselves primitives, so they land in wave 1 regardless.

### D4 — `ApiError` extends `Error`

The new error type carries `status`, `retryAfterSeconds` and `rateLimitRemaining`, and
**subclasses `Error`**. Every existing `err instanceof Error ? err.message : …` site keeps
working with no edit, including all 11 `useFetch` consumers. Branching on status is
opt-in at the call sites that need it.

`Retry-After` is parsed as delta-seconds only. The HTTP-date form is legal but our API
does not send it; anything non-integer yields `null` rather than a wrong number.

### D5 — `formatPrice` reproduces current output exactly; `Intl` is out of scope

Moving to `Intl.NumberFormat` changes rendered output to locale-dependent forms and would
churn a large number of existing assertions for no user-visible gain. `formatPrice`
renders byte-for-byte what the seven agreeing sites render today, and the two divergent
sites converge onto it. Wave 1 is therefore a pure de-duplication with **zero visual
change**. Currency conversion display stays with `formatConverted`.

### D6 — `Modal` gets a focus trap, not sibling `inert`

Store `document.activeElement` on open, focus the panel, trap Tab across the panel's
focusable descendants wrapping both directions, restore focus on close guarded by
`isConnected`.

The background is deliberately **not** marked `inert` or `aria-hidden`. `aria-modal="true"`
plus a real focus trap is what modern screen-reader and browser pairs honour; the trap is
what makes the existing `aria-modal` truthful. Mutating sibling nodes from a component
mounted inside a Next layout is invasive and leaks easily. This is a decision, not an
oversight.

### D7 — One shared announcer, mounted up front

A live region must exist in the DOM *before* its content changes or screen readers miss
the update. Per-component `aria-live` attributes fail exactly the debounced-search case
that motivates the finding. So: a single `<Announcer />` client component mounted once in
`(frontend)/layout.tsx`, rendering one polite `role="status"` region and one assertive
`role="alert"` region, with a `useAnnounce()` hook for callers.

`(frontend)/layout.tsx` is a server component — it exports `metadata` — so the announcer
is a small client child of it rather than a provider wrapping the layout itself.

### D8 — `generateMetadata` resolves as anonymous

Dynamic metadata applies `isPubliclyVisible(status)` and nothing else. A listing in a
public status (`active`, `reserved`, `sold`) gets its real title and description; anything
else gets the generic title plus `robots: { index: false }`.

Reading the session inside `generateMetadata` would make the served HTML vary by cookie —
a caching hazard for no benefit — and risks leaking a draft's title into a `<meta>` tag or
a link preview. Shared links to `reserved` and `sold` listings still preview correctly,
which is right: those statuses are publicly readable.

### D9 — The sitemap is narrower than the metadata rule

`sitemap.ts` emits public static routes plus **`active` listings only**, matching what
browse actually shows. A `reserved` listing is publicly readable but not for sale;
advertising it to a crawler produces a bad result page.

Seller profiles are deliberately excluded despite being public — thin pages, and including
them doubles the query surface for little indexing value.

### D10 — The frontend gains a direct database import

`generateMetadata` and `sitemap.ts` read through `listings-query` and drizzle rather than
fetching the app's own API over HTTP. This avoids a network hop per render, an absolute
base URL for internal calls, and a second implementation of the visibility rules.

It also means `src/app/(frontend)` imports from `src/db` for the first time. That boundary
has not been crossed before in this codebase and is recorded here so it reads as intended
rather than as a leak. Only server files — segment layouts, `sitemap.ts` — may do this;
no client component may.

---

## 3. Named findings and their tasks

### Critical

| ID | Finding | Task |
| --- | --- | --- |
| C1 | Production build fails — no Suspense around `useSearchParams()` | **closed by the API pass** |
| C2 | `Modal` has no focus management at all | 4 |
| C3 | No `aria-live` region anywhere in the app | 5 |

### High

| ID | Finding | Task |
| --- | --- | --- |
| H1 | No error boundary, no 404 page, no global error page | 23 |
| H2 | Failed photo upload strands an undeletable draft; retry duplicates it | 10 |
| H3 | No client-side size or type check despite the UI promising 5 MB | 10 |
| H4 | Terminal, irreversible order transitions fire on one unconfirmed click | 9 |
| H5 | After a purchase the listing still offers "Buy Now" | 7 |
| H6 | Searching from page 2+ returns an empty grid | 8 |
| H7 | `Card` declares `role="button"` on a div containing a heading and buttons | 14 |
| H8 | The browse page has no `<h1>`; hierarchy starts at h3 | 15 |
| H9 | The star rating input exposes no value and no selected state | 16 |
| H10 | `role="tab"` without tabpanels, ids or `aria-controls` | 17 |
| H11 | `ProtectedRoute` — the client-side auth and role gate — has no test | 26 |
| H12 | Price rendering duplicated nine times, two already disagreeing | 3 |
| H13 | Every `ui/` primitive is untested, including `Modal` and `StatusBadge` | 27 |
| H14 | Exchange rates uncached and unguarded; a missing rate mislabels currency *(promoted, D2)* | 12 |

### Medium

| ID | Finding | Task |
| --- | --- | --- |
| M1 | `api.ts` discards the HTTP status and the rate-limit headers | 1 |
| M2 | Every anonymous page load spends one of the 30-per-5-minute refresh attempts | 11 |
| M3 | Price filters are un-debounced and "Apply filters" is decorative | 8 |
| M4 | `useFetch` reports `loading: false` with the previous endpoint's data for one frame | 6 |
| M5 | Signing in loses the page you were trying to reach | 11 |
| M6 | The price field is a bare `type="number"`, so a comma decimal silently empties it | 13 |
| M7 | Deleting a saved listing photo is immediate, unconfirmed and silent | 10 |
| M8 | `useFetch` toasts every failure, including for sections that document themselves silent | 6 |
| M9 | `/settings` is unreachable from anywhere in the UI | 32 |
| M10 | Form errors are not summarised and focus is never moved | 19 |
| M11 | The register role selector conveys its selection by colour alone | 18 |
| M12 | `text-zinc-400` body text fails contrast at 2.56:1 | 20 |
| M13 | No `prefers-reduced-motion` support anywhere, and no skip link | 21 |
| M14 | `ButtonProps` is a closed prop list, so accessible buttons bypassed the design system | 2 |

---

## 4. The Low tier, enumerated

The review summarised these as a seven-row prose table. Enumerated for execution. The
count lands at **27**, near the review's "~30" but not identical, because some rows are a
single fix and others are several.

### Dead code

| ID | Item | Task |
| --- | --- | --- |
| L1 | Five barrel files with zero importers (`components/`, `listings/`, `orders/`, `reviews/`, `seller/`; only `ui/` is consumed) | 30 |
| L2 | Two inert `_metadata` exports | 30 |
| L3 | `useFetch`'s unused `deps` parameter, which exists only to justify an eslint-disable | 6 |
| L4 | `Modal`'s unread `dialogRef` | 4 |

### Duplication

| ID | Item | Task |
| --- | --- | --- |
| L5 | `Navbar` writes its whole nav twice and the seller block four times — ~110 duplicated lines of 281 | 31 |
| L6 | Three auth pages share a copy-pasted 20-line shell | 31 |
| L7 | A byte-identical email regex in three places — a fourth definition of "valid email" alongside `lib/validation.ts` and the API's Zod schema | 31 |

### Types

| ID | Item | Task |
| --- | --- | --- |
| L8 | `StatusBadge.status` is typed `string` then cast into two typed maps, so `status="sold"` without `kind="listing"` silently renders grey | 29 |
| L9 | `sort` is cast rather than validated, so `?sort=oldest` gives a dropdown reading "Newest" over oldest-first results | 29 |
| L10 | `CurrencySelect` takes `ReturnType<typeof useCurrencyConversion>` as a prop | 29 |

### Waste

| ID | Item | Task |
| --- | --- | --- |
| L11 | `formatConverted` is prop-drilled three levels down two separate trees | 12 |

*(The uncached third-party rate fetch from this row was promoted to H14 — see D2.)*

### Tests

| ID | Item | Task |
| --- | --- | --- |
| L12 | One test asserts `/flex/` against a class list containing `flex` and `min-w-0` — it cannot fail for the regression its own comment describes | 28 |
| L13 | One conditional assertion passes vacuously if the icon it checks is removed | 28 |
| L14 | `act()` warnings in three files, all from correctly testing an in-flight state | 28 |
| L15 | Coverage config excludes the entire frontend from measurement | 28 |

### Polish

| ID | Item | Task |
| --- | --- | --- |
| L16 | Reviews are the one empty collection without `EmptyState` | 32 |
| L17 | `/seller` is not role-gated, so a buyer reaches a dead-end dashboard | 26 |
| L18 | Dates format two ways | 32 |
| L19 | The same user gets two different generated avatars from three different seeds | 32 |
| L20 | Pagination renders below the empty state | 32 |
| L21 | No loading state on the Swagger bundle | 32 |
| L22 | No unsaved-changes guard on the listing form | 32 |
| L23 | Duplicate React keys when two picked files share a name and size | 32 |

### Semantics

| ID | Item | Task |
| --- | --- | --- |
| L24 | Icons from `@remixicon/react` ship without `aria-hidden`; only four call sites add it | 22 |
| L25 | Breadcrumbs are spans rather than a list | 22 |
| L26 | `MatchQuality` puts its only quantitative content in a `title` attribute on a non-focusable span | 22 |
| L27 | Alt text uses database IDs | 22 |

---

## 5. Found during design, not in the review

Two latent defects in `Modal`, both fixed by task 4 since it is already rewriting that
element:

- **`aria-labelledby="modal-title"` is a hardcoded id.** Two modals mounted at once
  produce duplicate ids, and the second dialog's accessible name resolves to the first
  one's heading. `InputField` already solves this correctly with `useId()`.
- **`role="dialog"` sits on the backdrop container (`Modal.tsx:58`), not the panel**, so
  the overlay div is inside the dialog's accessible subtree. Moving the role onto the
  panel is the same edit that adds the trap.

---

## 6. Wave structure

### Wave 1 — Shared primitives (tasks 1–6)

Both remaining Criticals live here, because both are primitives. Nothing later reopens
these files.

1. `ApiError` in `api.ts` carrying `status`, `Retry-After`, `X-RateLimit-*` — M1
2. `ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>` — M14
3. New `src/lib/format.ts` with `formatPrice` — H12
4. `Modal` focus management, `useId()` title, role moved to panel — **C2**, L4, §5
5. `<Announcer />` and `useAnnounce()` — **C3**
6. `useFetch`: atomic state, render-time endpoint reset, `onError` opt-out, drop `deps` — M4, M8, L3

**Primitive API sketches**

```ts
// Task 1 — src/lib/api.ts
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly rateLimitRemaining: number | null;
}

// Task 2 — src/components/ui/Button.tsx
export type ButtonProps =
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
    variant?: Variant;
    size?: Size;
    icon?: React.ReactNode;
    loading?: boolean;
    fullWidth?: boolean;
    type?: "button" | "submit" | "reset";
  };

// Task 3 — src/lib/format.ts
export function formatPrice(value: number | string): string;

// Task 5 — src/components/ui/Announcer.tsx
export function useAnnounce(): (message: string, opts?: { assertive?: boolean }) => void;
```

`onClick`, `disabled`, `className`, `children` and `title` all arrive from the native
button type in task 2; the `type` narrowing survives via `Omit`. The JSDoc on `title`
recording the C2C-AI-6 AC5 requirement moves onto the type rather than being lost.

Task 6 resets state **during render** when `endpoint` changes — React's adjust-state-on-
prop-change pattern — which removes the stale frame outright instead of racing it with a
passive effect.

### Wave 2 — Consumers (tasks 7–13)

Each of the 19 Button files and 11 `useFetch` files is opened once, with the primitives
settled.

7. Buy flow — refetch after purchase, branch on 409 — H5
8. Browse state — `setPage(1)` on search, debounce price filters, make "Apply filters" honest — H6, M3
9. Order actions — confirm the two terminal transitions — H4
10. Upload — client size/type check, stop stranding drafts, stop duplicating on retry, confirm photo delete — H3, H2, M7
11. Auth flow — honour `returnTo` on the password path, get `/api/auth/me` out of the refresh path — M5, M2
12. Currency — cache, timeout, retry, fail visibly rather than mislabelling — H14, L11
13. Price input — accept a comma decimal — M6

### Wave 3 — Accessibility batch (tasks 14–22)

14. `Card` becomes a link — H7
15. Browse `h1` and named landmark sections — H8
16. Star rating radiogroup semantics — H9
17. Seller tabs drop the fake `role="tab"` for `aria-current` — H10
18. Register role selector semantics — M11
19. Form error summary and focus move — M10
20. Contrast `zinc-400` → `zinc-500`, plus the `zinc-300` breadcrumb — M12
21. Reduced-motion block, skip link, `sr-only` utility — M13
22. Icon `aria-hidden`, breadcrumb list, `MatchQuality`, alt text — L24–L27

### Wave 4 — Architecture (tasks 23–25)

23. `error.tsx`, `not-found.tsx`, `global-error.tsx` — H1
24. Server segment layouts with static metadata and `generateMetadata`
25. `sitemap.ts` and `robots.ts`

**Task 23.** `not-found.tsx` and `error.tsx` at `(frontend)/`, built from the existing
`EmptyState` and `Button` primitives so they inherit the app chrome. `error.tsx` is a
client component taking `{ error, reset }` and wires `reset` to a "Try again" button.
`global-error.tsx` sits at `src/app/` and **must render its own `<html>` and `<body>`** —
it replaces the root layout, so it cannot use any app chrome and gets a deliberately
plain, dependency-free treatment.

**Task 24.** Every segment gets `export default function Layout({ children }) { return children }`
plus metadata. No DOM node is added; the layout exists purely to carry an export a client
page cannot have. This is what finally supplies the `%s` that both layouts'
`title.template` has been waiting for.

- Static titles: `/listings`, `/listings/new`, `/listings/[id]/edit`, `/login`,
  `/register`, `/link-account`, `/settings`, `/orders`, `/seller`, `/api-docs`
- `robots: { index: false }` on `/orders`, `/orders/[id]`, `/settings`, `/seller`,
  `/link-account`, `/listings/new`, `/listings/[id]/edit`. These sit behind
  `ProtectedRoute`, but a crawler reaching one otherwise indexes a redirect-to-login page
  under a real title.
- `generateMetadata` for `/listings/[id]` and `/users/[id]`, via a new single-listing
  server helper alongside `runListingQuery`, applying D8.

**Task 25.** Per D9. The listing query is capped, with `generateSitemaps` noted as the
escape hatch if the catalogue approaches the 50k URL limit.

### Wave 5 — Tests, types, dead code, polish (tasks 26–32)

26. `ProtectedRoute` tests, and role-gate `/seller` — H11, L17
27. `Modal`, `StatusBadge`, `Button` tests — H13
28. Repair the broken and vacuous tests, the `act()` warnings, and the coverage config — L12–L15
29. Types — `StatusBadge.status`, `sort` validation, `CurrencySelect`'s prop — L8–L10
30. Dead code — five unused barrels, two inert `_metadata` — L1, L2
31. `Navbar` dedup, shared auth-page shell, one email regex — L5–L7
32. Polish batch — `EmptyState` for reviews, `/settings` link, date formats, avatar seeds, pager placement, Swagger loading state, unsaved-changes guard, duplicate keys — M9, L16, L18–L23

**Ordering hazard.** Task 30 must not run before task 24. Deleting the two `_metadata`
exports is only correct once those segments have a real `generateMetadata`. If wave 4
slips, task 30 leaves them in place rather than deleting them and leaving nothing behind.

---

## 7. Verification strategy

### 7.1 The bar, per task

Name the test that will fail → write it → watch it fail → implement → watch it pass →
**delete the guard and confirm the named test fails** → restore.

Same standard as the API pass. The deliberate break is what separates a test that
describes the fix from one that detects its absence.

### 7.2 Proof by finding kind

| Kind | Proof | Vitest project |
| --- | --- | --- |
| Behaviour — pagination reset, refetch, upload validation, draft retry, `returnTo`, comma decimal | Component test driving the real component with `user-event` | `component` |
| Modal focus trap | `userEvent.tab()` exercises real focus order in jsdom | `component` |
| Live regions | Assert the shared `role="status"` node's text after the triggering action | `component` |
| ARIA semantics — `Card`, star rating, tabs, role selector, headings | Role and accessible-name queries, the idiom the suite already uses well | `component` |
| Contrast | Unit test computing WCAG relative luminance from Tailwind hex values | `unit` |
| `generateMetadata` visibility | Integration test — a draft must not leak its title. Security boundary, so same treatment as the API boundaries | `integration` |
| `sitemap` / `robots` / error pages | Unit and component tests against the exported functions and components | `unit` / `component` |

`axe-core` was considered and rejected. In jsdom it cannot evaluate contrast (no layout,
no computed colour), cannot detect a missing focus trap, and cannot see
`prefers-reduced-motion` — precisely the Criticals and Highs. What it would catch is
already covered by the role and accessible-name queries the review singled out as a
strength of the existing suite.

### 7.3 The contrast test has two halves

The ratio alone does not stop a regression:

1. Compute the ratio for each muted-text token the design system permits and assert
   ≥ 4.5:1. Reverting `zinc-500` to `zinc-400` fails it.
2. Scan `src/**/*.tsx` and assert `text-zinc-400` and `text-zinc-300` appear zero times,
   with a deliberate exception honoured only when it carries an inline justification
   comment — the same shape as the `<img>` convention this repository already encodes in
   eslint.

### 7.4 The one weak proof, stated as such

`prefers-reduced-motion` cannot be executed in jsdom; there is no CSS engine. Its proof is
a unit test asserting the `@media (prefers-reduced-motion: reduce)` block exists in
`globals.css`. That is weaker than every other proof in this document. It is still
falsifiable, which is the minimum bar, and it is recorded here rather than dressed up.

### 7.5 Regression guard on the code the review praised

Wave 1 rewrites `api.ts` and `useFetch` — the two files owning the properties the review
identified as the best work in the codebase:

- the single-flight refresh that stops five concurrent 401s from presenting already-rotated
  tokens and tripping theft detection, revoking the family
- the per-effect `alive` flag that closes the search-as-you-type race

Tasks 1 and 6 are the likeliest place in this pass to silently break something that
currently works. Both get a named test proving the property still holds *after* the
change, and the deliberate break is run against those tests too.

### 7.6 Coverage

`coverage.include` grows to cover `src/app/(frontend)/**`, `src/components/**`,
`src/hooks/**` and `src/context/**`. No thresholds — the existing comment defers those to
a measured baseline, and this pass is not the place to set them.

---

## 8. Global constraints

Carried over from the API pass, where they were learned the hard way.

1. **Never point any command at `DATABASE_URL`.** It is the developer's own database and
   the migrations are destructive to it. Integration tests manage their own throwaway
   Testcontainers instance.
2. **Implementers run focused projects only** — `--project component`, `--project unit`.
   The full suite takes roughly 14 minutes against a 600-second foreground cap, so an
   implementer running `npm test` stalls every time. The controller runs the full suite at
   wave boundaries, backgrounded.
3. **A task is not done until its deliberate break has been run and the named test
   observed failing.** Reporting the break without running it is the failure mode this
   guards against.
4. **No new runtime dependencies** without an explicit decision recorded here. `axe-core`
   was considered and rejected in §7.2.

---

## 9. Operational gates

New before deploy, in addition to the two the API pass introduced:

| Gate | Why |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` must be set | `sitemap.ts` and `robots.ts` need an absolute base URL. Added to `.env.example` with the local default documented. Same treatment `TRUSTED_PROXY_HOPS` received. |

Carried forward from the API pass and still required:

| Gate | Why |
| --- | --- |
| Run migrations with `drizzle-kit migrate`, never `push` | `push` reconciles to the TypeScript schema and would drop the two indexes added by `0019` and `0020`. |
| `TRUSTED_PROXY_HOPS` must match actual proxy depth | Otherwise the rate limiter fails open, audibly. |

---

## 10. Out of scope

- **`Intl.NumberFormat`** for price rendering — D5.
- **Server-rendering listing page content.** The user chose segment layouts with
  `generateMetadata`, not a server shell plus client island. Listing *content* remains
  client-rendered; only metadata becomes server-side.
- **Coverage thresholds** — §7.6.
- **`axe-core`** — §7.2.
- **Sibling `inert` on modal open** — D6.
- **Seller profiles in the sitemap** — D9.

---

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Wave 1 regresses the single-flight refresh or the `alive` guard | Named regression tests plus deliberate break — §7.5 |
| Task 30 deletes `_metadata` before wave 4 replaces it | Explicit ordering hazard recorded in §6; task 30 holds if wave 4 slips |
| The `text-zinc-400` ban has false positives on decorative elements | Inline justification comment honoured by the scan — §7.3 |
| `generateMetadata` leaks a draft listing's title | D8 resolves as anonymous; proved by integration test — §7.2 |
| The frontend's new `src/db` import spreads to client components | D10 restricts it to server files; any violation is a build error, since client components importing drizzle fail to compile |
| 32 tasks is a large pass and later waves drift from earlier decisions | Wave boundaries run the full suite; each task reports against the finding IDs in §3 and §4 |

---

## 12. Baseline

At `develop` @ `3707b0f`, measured rather than assumed:

- `npm test` — 1703 passed, 8 skipped, 0 failed
- `npm run build` — succeeds, all 28 routes
- `tsc --noEmit` — clean
- `npm run lint` — 0 errors, 0 warnings
- 23 component test files; 14 pages, 13 of them `"use client"`; 2 layouts

Review baseline for comparison, at `develop` @ `f0c5164`: 1526 tests passing, 202
component tests, eslint at 0 errors and 3 warnings, and `next build` failing.
