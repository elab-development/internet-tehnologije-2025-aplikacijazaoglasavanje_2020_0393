# Frontend Refactor Brief

> **For a Claude Code session working ONLY on the frontend of this repo.**
> A parallel session is working on the backend at the same time. Respect the file
> ownership boundary in §2 or you will create merge conflicts.

---

## 1. Context

**Repo:** `D:\FON\Polozeno\IV godina\Internet tehnologije\iteh-c2c-ecommerce`
**App root:** `c2c-e-commerce/` (the repo root `package.json` is vestigial — ignore it)
**Branch:** `develop`
**Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Drizzle ORM + Postgres, Vitest

This is a C2C marketplace (listings, orders, reviews) with three roles: `buyer`, `seller`, `admin`.

A full code review found the frontend structure is sound at the top (route groups, `lib`/`hooks`/`context` separation) and at the bottom (`components/ui` primitives are well-built, with `forwardRef`, `useId`, proper ARIA). **The problem is the missing middle layer**: there are ~100-line primitives and then 300–650-line pages, with no composite/domain components in between. Every page therefore re-implements the same domain pieces inline.

Measured duplication across `src/app/(frontend)`:

| Repeated block | Copies |
|---|---|
| `role="alert"` ⚠️ error banner | 9 |
| `py-20 text-center` empty state | 4 |
| "Convert price" label + select + error | 4 |
| `let alive = true` fetch effect | 6 |
| status → color pill map | 3 separate maps |

`useState` counts per page: `listings/[id]` 15, `listings` 12, `listings/new` 11, `seller` 10.

**Run before and after your work:**
```bash
cd c2c-e-commerce
npx tsc --noEmit     # currently clean — keep it clean
npx vitest run       # currently 48/48 pass — keep them passing
npm run lint
```

---

## 2. File ownership (IMPORTANT)

**You own — edit freely:**
- `src/components/**`
- `src/app/(frontend)/**`
- `src/hooks/**` (except see the ban below)
- `src/types/**` (new)

**DO NOT TOUCH — the backend session owns these:**
- `src/app/api/**`
- `src/lib/api.ts`, `src/lib/auth.ts`, `src/lib/middleware.ts`, `src/lib/validation.ts`, `src/lib/response.ts`
- `src/context/AuthContext.tsx`
- `src/db/**`
- `.github/**`, `Dockerfile`, `docker-compose*.yml`, `package.json`

**Specifically banned:** do not change how the auth token is stored or sent. The backend session is migrating the JWT from `localStorage` to an httpOnly cookie, which touches `lib/api.ts` and `AuthContext.tsx`. Keep calling `api.get/post/put/delete` exactly as pages do today — the wrapper's signature will not change.

**API response shapes will not change.** Endpoint behaviour is being fixed (validation, a security bug in `GET /api/listings`), but the JSON shapes your components consume stay identical. One exception: `GET /api/listings?sellerId=…` will start correctly restricting results to that seller — this only affects `seller/page.tsx`, and only by returning fewer/correct rows.

---

## 3. Tasks

Do them in this order — each builds on the last. Commit after each task.

### Task 1 — `useFetch` hook (biggest win, do first)

Create `src/hooks/useFetch.ts`. Six pages hand-roll this identical effect (`seller/page.tsx:100-155` has two copies back to back; also in `listings/page.tsx`, `listings/[id]/page.tsx`, `listings/new/page.tsx`, `orders/page.tsx`, `orders/[id]/page.tsx`):

```ts
useEffect(() => {
  let alive = true;
  async function load() {
    try {
      setLoading(true); setError(null);
      const data = await api.get<T>(endpoint);
      if (!alive) return;
      setData(data);
    } catch (err: unknown) {
      if (!alive) return;
      const msg = err instanceof Error ? err.message : "Failed to load";
      setError(msg); toast.error(msg);
    } finally { if (alive) setLoading(false); }
  }
  load();
  return () => { alive = false; };
}, [deps]);
```

Signature: `useFetch<T>(endpoint: string | null, deps?: unknown[])` returning `{ data, loading, error, refetch }`. A `null` endpoint means "not ready yet, don't fetch" — needed because `seller/page.tsx` waits on `user` before requesting listings.

Preserve the `alive` cancellation guard and the `toast.error` on failure (both are existing behaviour). Then migrate all six call sites. This should remove ~40 lines per page and collapse each resource's three `useState`s into one hook call.

### Task 2 — Three missing UI primitives

All three go in `src/components/ui/` and must be added to the `src/components/ui/index.ts` barrel (follow the existing export style — default export + named type export).

**`ErrorAlert.tsx`** — replaces 9 copies. Canonical markup (from `orders/page.tsx:109-114`):
```tsx
<div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
  <span className="shrink-0 mt-0.5">⚠️</span>
  <span>{message}</span>
</div>
```

**`EmptyState.tsx`** — replaces 4 copies. Props: `icon`, `title`, `description`, optional `action`. Canonical markup at `orders/page.tsx:123-130` and `seller/page.tsx` (two copies).

**`StatusBadge.tsx`** — replaces 3 separate colour maps. This one has a real bug to fix: `seller/page.tsx:60` declares `statusClasses` at module level, `orders/page.tsx` declares its own copy plus a `statusLabels` map, and `seller/page.tsx:427` declares `listingStatusClasses` **inside a `.map()` callback**, so it is rebuilt for every card on every render. Consolidate into one component with two maps (order statuses and listing statuses) declared once at module level.

Order statuses: `pending` amber, `paid` blue, `shipped` indigo, `completed` emerald, `cancelled` red, `approved` green, `rejected` red.
Listing statuses: `active` emerald, `sold` blue, `removed` zinc.
Keep the existing `?? "bg-zinc-100 text-zinc-500"` fallback.

### Task 3 — `CurrencySelect` component

`src/components/CurrencySelect.tsx`. The ~20-line label + `<select>` + error block is duplicated 4× — `listings/[id]/page.tsx:292`, `orders/page.tsx:90`, `orders/[id]/page.tsx:157`, `seller/page.tsx:246`. Only the `id` attribute differs between them.

It pairs with the existing `src/hooks/useCurrencyConversion.ts` (do not rewrite that hook — it works). Let the component take the hook's return values as props, or call the hook itself if that turns out cleaner at the call sites. Use `useId()` for the input id, matching how `InputField.tsx` already does it, instead of passing an `id` prop.

### Task 4 — Split `seller/page.tsx` (647 lines)

It holds two independent screens (an "Incoming Orders" tab and a "My Listings" tab) plus 10 `useState`s in one component. Split into:
- `src/components/seller/SellerOrdersTab.tsx`
- `src/components/seller/SellerListingsTab.tsx`

Leave the tab switcher, the header, and the `ProtectedRoute` wrapper in `page.tsx`.

While splitting, fix the worst readability spot in the codebase: the `<Card footer={…}>` at `seller/page.tsx:~440-520` passes roughly 60 lines of inline JSX into a prop. Extract that into a `SellerListingCard` component.

Also promote the local `OrderCard` (currently at the bottom of `seller/page.tsx`) to `src/components/orders/OrderCard.tsx`. `orders/page.tsx` hand-rolls an equivalent card via `<Card footer={…}>` — unify them with a `variant` or `showActions` prop if the shapes reconcile cleanly. **If they don't reconcile without contortion, leave `orders/page.tsx` alone and just move the component** — a forced abstraction is worse than the duplication.

### Task 5 — Shared API types

Create `src/types/api.ts`. Currently `Listing` is declared in both `listings/page.tsx:19` and `listings/[id]/page.tsx:14`, `ListingsResponse` is declared twice (`listings/page.tsx:33`, `seller/page.tsx:52`), and order shapes exist in four variants (`Order`, `OrderDetail`, `SellerOrder`, `SellerOrderItem`, `OrderItem`).

Derive from the Drizzle schema where possible so the frontend and backend cannot drift silently — `src/db/schema/*.ts` already exports `typeof listings.$inferSelect` etc. **Read those files but do not modify them.**

Watch out: API responses are not always raw table rows. `GET /api/listings/[id]` returns joined extras (`sellerName`, `categoryName`), `GET /api/orders/seller` returns `buyerName`/`buyerEmail` plus a nested `items` array, and `createdAt` arrives as a JSON string, not a `Date`. Model these as `Omit`/`&` extensions of the inferred row types rather than redeclaring fields by hand.

### Task 6 — Delete `useRequireAuth`, fix the edit route

**a)** `src/hooks/useRequireAuth.ts` is fully written and documented but **imported by zero files**. `ProtectedRoute.tsx` does the same job and is used by 3 pages. Delete the hook — keep `ProtectedRoute`, which correctly renders nothing during the redirect, something the hook cannot do.

**b)** `/listings/new?id=5` is currently the *edit* screen: `listings/new/page.tsx:42` computes `isEditMode` and the file branches on it 8 times, and `seller/page.tsx` navigates there to edit a listing. Extract the shared form into `src/components/listings/ListingForm.tsx` with a `mode: "create" | "edit"` prop, then add a proper `src/app/(frontend)/listings/[id]/edit/page.tsx` route. Update the navigation in the seller listings tab. Keep `/listings/new` working for creation.

---

## 4. Out of scope

Do **not** attempt the React Server Components migration. All 9 frontend pages are currently `"use client"` with no `async` server components, and converting the public read pages (`/listings`, `/listings/[id]`) to server components is a worthwhile future change — but it interacts with `AuthContext` and the backend session's cookie migration. It is deliberately deferred. Mention it in your summary; don't do it.

---

## 5. Definition of done

- `npx tsc --noEmit` clean
- `npx vitest run` still 48/48 (these are backend lib tests; you shouldn't affect them — if you do, you touched a banned file)
- `npm run lint` clean
- `npm run build` succeeds
- Zero remaining copies of the 5 duplicated blocks in the §1 table
- No file over ~300 lines in `src/app/(frontend)`
- Every new component exported through the appropriate barrel

Manual smoke test if you can run the app (`docker compose up -d db` then `npm run dev` in `c2c-e-commerce`, seed with `npm run db:seed`; seeded accounts are `buyer@example.com` / `seller@example.com` / `admin@example.com`, all with password `password123`): log in as seller, check both dashboard tabs render, create and edit a listing, place an order as buyer.

**Report at the end:** what you changed, anything you chose not to do and why, and any backend issue you noticed but correctly left alone.
