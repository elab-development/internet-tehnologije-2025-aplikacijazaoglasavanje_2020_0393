# Listings, orders, reviews and categories — redesign

**Date:** 2026-08-30
**Status:** Approved design, not yet planned
**Supersedes:** the listing/order/review behaviour described in `docs/backlog/JIRA-BACKLOG.md`

---

## 1. Why

The marketplace was built as a general e-commerce app and then used as a
peer-to-peer one. Four consequences follow from that mismatch, and they are the
whole of this document.

**Nothing reserves a listing.** `POST /api/orders` checks `status = 'active'`
and locks the rows `FOR UPDATE`, but a listing only becomes `sold` when the
seller *approves* the order. Between those two moments a second buyer passes the
identical check. The lock serialises the writes; it does not prevent the second
sale. For unique second-hand goods that is a double-sell.

**`quantity` exists but stock does not.** `order_items.quantity` accepts any
positive integer against a listing that is, by construction, one physical
object. No UI has ever sent a value other than the default.

**The status enum is a muddle.** Seven values — `pending`, `paid`, `shipped`,
`completed`, `cancelled`, `approved`, `rejected` — with no transition graph and
overlapping meanings. `paid` is never set by any flow; there is no payment
integration. Review eligibility keys off a hand-maintained subset of the enum
(`PURCHASED_ORDER_STATUSES`), which is a comment pretending to be a rule.

**Reviews cannot accumulate.** They attach to a listing. A one-off listing
receives at most one review and is then `sold`, so the rating is stranded on a
dead page and a seller's track record is invisible.

Two further changes ride along because they touch the same surfaces: photos are
free-text URLs rather than uploads, and categories are a flat list that cannot
express "Electronics › Phones › Smartphones".

## 2. Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | **Collapse `orders` + `order_items` into one row per purchase** | No cart exists, one call site, `quantity` never sent. The join is unpaid-for generality and is where the authorisation complexity comes from — the SEC-10 ownership bug lived in exactly that reconciliation. |
| D2 | **Reserve the listing at order time; the seller then confirms or declines** | Closes the double-sell with a conditional `UPDATE … RETURNING`, making the race unrepresentable rather than merely locked against. Keeps the seller's right to decline. |
| D3 | **Reservations expire after 48 hours** | Long enough for a weekend day and an ordinary response lag; short enough that a buyer is not left hanging and a listing is not frozen by a seller who lost interest. |
| D4 | **Expiry correctness does not depend on the sweep** | The reserve path lazily expires stale orders in its own transaction. The scheduled sweep exists so listings return to browse promptly, not so the data stays correct. |
| D5 | **Sellers may buy** | Peer-to-peer means everyone is both. Adds a `seller_id ≠ buyer_id` guard, which is not needed today only because sellers cannot buy at all. |
| D6 | **Reviews are buyer → seller, anchored to an order** | The order is the proof of transaction and the natural uniqueness key. Seller reputation accumulates across one-off listings, which was the point. |
| D7 | **Seller rating is denormalised as `rating_sum` + `review_count`** | Integers, so every update is exact and the mean is derived. Removes a `GROUP BY` from any listing query that wants to show a rating. |
| D8 | **Photos are uploaded, stored behind a `StorageProvider` interface, local-disk driver first** | Mirrors the `LlmProvider` seam: one interface, a real driver and a mock, selected by environment. An S3 driver becomes a drop-in with no call-site changes. |
| D9 | **`listings.image_url` is dropped outright** | Keeping a nullable `external_url` beside `storage_key` would preserve the hotlinking surface being removed, keep `remotePatterns` alive, and leave two code paths in every renderer. `seed.ts` ships real sample files through the provider instead. |
| D10 | **Uploads are re-encoded with `sharp`** | Strips EXIF — including home GPS coordinates on phone photos — and structurally neutralises polyglot files. Magic-byte validation alone validates rather than neutralises. |
| D11 | **Category tree = `parent_id` + materialised `path`** | Descendant filtering becomes an indexed prefix match, off the recursive path on every browse query. Subtree rewrites on re-parent are rare and easy to test. |
| D12 | **Listings attach to leaf categories only**, and a category holding listings may not be given subcategories | A listing filed under "Electronics" when "Electronics › Phones" exists is invisible to anyone drilling down. Enforcing this only when a *listing* is written leaves the other direction open: giving a category children strands the listings already on it, and — because the edit form resends `categoryId` unchanged — locks their sellers out of editing them. Both directions are guarded. |
| D13 | **Category depth is capped at 3** | Deeper taxonomies are unusable in a cascading select and nobody maintains them. |

## 3. Part 1 — Category tree

### 3.1 Schema

`categories` gains four columns:

```
parent_id   integer references categories(id) on delete restrict   -- null = root
path        text not null      -- '3', '3.7', '3.7.12' — ancestor ids including self
depth       integer not null   -- 0 for roots
sort_order  integer default 0  -- curated order within a parent
```

`sort_order` exists because alphabetical is wrong for a taxonomy: "Phones"
should precede "Accessories" when that is the useful order. `path` carries a
`text_pattern_ops` index so prefix matching uses it. `on delete restrict` on
`parent_id` means deleting a node that still has children fails loudly rather
than orphaning a subtree.

### 3.2 Path maintenance

Writes happen in one transaction. An insert cannot know its own id first, so it
inserts, then sets `path = parent.path || '.' || id` from the returned id — one
extra statement, same transaction.

Re-parenting is a single prefix rewrite over the subtree
(`WHERE path LIKE old || '.%'`) plus a cycle check: **the new parent's path must
not start with this node's path**, or a category becomes its own ancestor.

Depth is recomputed for the moved subtree and rejected if any node would exceed
the D13 cap.

### 3.3 Filtering

`?categoryId=N` changes meaning. It becomes "N and everything beneath it":

```sql
category_id IN (
  SELECT id FROM categories WHERE id = $n OR path LIKE $p || '.%'
)
```

This is a deliberate behaviour change to an existing public parameter and must
be noted in the Swagger description. Path values are server-generated digits and
dots, so nothing user-controlled reaches the `LIKE` pattern.

### 3.4 API

`GET /api/categories` stays a flat array and gains the new columns — a strict
superset, so every existing consumer keeps working untouched. The client builds
the tree from `parent_id` in one pass; at a few dozen categories a dedicated
`/tree` endpoint would be machinery for nothing.

`POST` and `PUT` accept `parentId` and compute `path`/`depth` server-side. `PUT`
handles re-parenting. `DELETE` refuses a node with children.

Validation rejects: an unknown `parentId`, a depth above the cap, a cycle, and —
on listings — a `categoryId` that is not a leaf (D12).

D12 is enforced in **both** directions, because a rule stated as a property of the
data has to be defended wherever the data can change. A listing write rejects a
non-leaf `categoryId` with 400. A category write — `POST` with a `parentId`, or
`PUT` re-parenting a category under another — rejects with 409 when the
prospective parent already holds listings, instructing the admin to move them
first. Guarding only the listing side would let an admin strand existing listings
on a category that has just gained children, and the edit form resends
`categoryId` unchanged, so those sellers could no longer edit their own listings
at all.

The path, depth and cycle
rules live as pure functions in `src/lib/categories.ts` so they are unit-testable
away from the database.

### 3.5 UI

- `ListingForm`: cascading selects, level 1 → 2 → 3, submitting the deepest
  selection, which must be a leaf.
- Browse filter: a collapsible category tree replacing the flat dropdown.
  Selecting a parent includes its descendants.
- Listing detail: a breadcrumb built from `path`.
- `seed.ts`: a real two-to-three-level taxonomy replacing the flat list.

## 4. Part 2 — Photo uploads

### 4.1 Storage provider

The same idiom as `src/lib/ai/llm.ts`: one interface, two implementations,
selected by environment, with a typed error carrying a `kind` union.

```ts
export interface StorageProvider {
  put(bytes: Buffer, opts: { contentType: string; prefix: string }): Promise<StoredObject>;
  get(key: string): Promise<{ stream: ReadableStream; contentType: string } | null>;
  delete(key: string): Promise<void>;
}
```

`LocalStorageProvider` writes under `STORAGE_DIR` on a Docker volume.
`MemoryStorageProvider` backs tests and offline demos, so the integration suite
never touches a filesystem.

Keys are generated server-side as `listings/<id>/<random>.webp` and validated
against a strict pattern before any path is joined. **The client's filename
never reaches disk.**

### 4.2 Schema

New `listing_images`:

```
listing_id    → listings (cascade)
storage_key   text not null
content_type  text not null
byte_size     integer not null
width, height integer
sort_order    integer not null default 0
created_at    timestamp
```

Cover image is the lowest `sort_order`. `listings.image_url` is dropped (D9),
and `next.config.ts`'s `images.remotePatterns` block goes with it, since every
image is now same-origin.

**Existing rows lose their images.** A migration cannot fetch remote URLs.
`seed.ts` is reworked to push sample files shipped in the repo through the
storage provider, so seeded data and real uploads take exactly one code path.

### 4.3 How a listing gets made

`listings.status` gains `draft`. The form stays a single page with one button;
the submit handler performs create-as-draft → upload each file → publish.
Previews before submit come from local object URLs, so there is no staging area
and no orphan collection: a half-finished listing is a draft its owner sees in
their dashboard and can finish or delete.

Drafts are excluded from browse, search, similar-listings and recommendations.

### 4.4 Upload endpoint

`POST /api/listings/[id]/images`, multipart. Owner-or-admin through the SEC-10
authorisation helpers, rate-limited through the existing limiter.

Limits: at most 8 images per listing, 5 MB each.

Type is decided by **magic bytes** — never the `Content-Type` header, never the
extension. Accepted input: JPEG, PNG, WebP. Everything is then re-encoded to
WebP with `sharp` (D10).

`DELETE /api/listings/[id]/images/[imageId]` removes a row and its object.
Reordering is a `PATCH` carrying the new `sort_order` sequence.

### 4.5 Serving

`GET /api/images/[id]` resolves the row and streams from the provider with
`X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, and a long
immutable cache header — keys are random, so a URL never outlives its bytes.

### 4.6 Docker

A named volume at `/app/uploads`, with `STORAGE_DRIVER` and `STORAGE_DIR`
forwarded **explicitly in every compose file**. Compose only passes variables it
names; the OAuth variables are currently missing from all of them, and this is
the same trap.

`sharp` is a native binary. Expect the `serverExternalPackages` lever that
`@huggingface/transformers` already needed.

## 5. Part 3 — Order lifecycle

### 5.1 Schema

`orders` absorbs the item; `order_items` is dropped.

```
orders:
  buyer_id    → users     (cascade)
  seller_id   → users     (cascade)   -- captured at order time
  listing_id  → listings  (restrict)
  price       numeric(10,2)           -- captured at order time
  status      order_status
  expires_at  timestamp               -- D3; set at creation
  created_at, updated_at
```

`total_price` and `quantity` are removed: with one listing per order, the price
*is* the total.

`seller_id` is denormalised deliberately. It turns the seller dashboard into a
column filter instead of an ownership reconciliation, it makes review
eligibility a single-table predicate, and capturing it at order time means a
later listing edit cannot retroactively change who a past transaction was with.

### 5.2 Reservation

The conditional-`UPDATE`-`RETURNING` idiom already used for refresh-token
rotation:

```sql
UPDATE listings SET status = 'reserved'
WHERE id = $1 AND status = 'active'
RETURNING id, price, seller_id
```

Zero rows means someone else got there first → **409**. The order row is
inserted in the same transaction, priced from the `RETURNING` values rather than
from anything the client sent.

`POST /api/orders` also rejects `seller_id = buyer_id` with 403 (D5).

### 5.3 Status graph

```
                ┌─ decline(seller) ────→ declined
                ├─ cancel(buyer) ──────→ cancelled
pending ────────┤
                ├─ 48h elapsed ────────→ expired
                └─ confirm(seller) ────→ confirmed
                                            ├─ cancel(either party) ─→ cancelled
                                            └─ ship(seller) ────────→ shipped
                                                       ├─ cancel(either party) ─→ cancelled
                                                       └─ receive(buyer) ──────→ completed
```

Terminal: `completed`, `declined`, `cancelled`, `expired`.

**Who may cancel:** from `pending`, the buyer only — the seller's refusal is
`declined`, which is a different fact about the transaction. From `confirmed`
and `shipped`, either party, because a deal falling through after acceptance can
originate on either side. Admins may perform any legal transition.

`paid` is dropped — no flow sets it and there is no payment integration, so it
has only ever been a lie. `approved`/`rejected` become `confirmed`/`declined`.

`expired` is a seventh state, and that is deliberate. The complaint about the old
enum was overlapping meanings, not the count: telling a buyer their order was
"cancelled" when they cancelled nothing is exactly the sort of overlap being
removed.

**Only `completed` unlocks a review.** `PURCHASED_ORDER_STATUSES` and
`src/lib/review-eligibility.ts` are deleted; the concept is now one enum value.

Listing side effects ride in the same transaction as the status change:

| Transition | Listing becomes |
|------------|-----------------|
| → confirmed | `sold` |
| → declined, → cancelled, → expired | `active` |
| → shipped, → completed | unchanged |

Transitions live in `src/lib/order-lifecycle.ts` as
`canTransition(from, to, actor)` — the same shape as `authorization.ts`. The
`PUT` route becomes: resolve the order, check the actor is a party to *this*
order, check the transition is legal, apply.

### 5.4 Expiry

The deadline lives on `orders.expires_at`, set at creation. Listing status is
derived state the transaction maintains. Correctness never depends on the sweep
(D4) — the reserve path lazily expires first:

```sql
-- 1. expire stale pending orders on this listing
UPDATE orders SET status = 'expired'
WHERE listing_id = $1 AND status = 'pending' AND expires_at < now();

-- 2. release the listing if nothing pending holds it any more
UPDATE listings SET status = 'active'
WHERE id = $1 AND status = 'reserved'
  AND NOT EXISTS (SELECT 1 FROM orders WHERE listing_id = $1 AND status = 'pending');

-- 3. the claim, unchanged
UPDATE listings SET status = 'reserved' WHERE id = $1 AND status = 'active' RETURNING …
```

`npm run db:expire-reservations` runs steps 1–2 globally so listings return to
browse without waiting for a buyer to bump into them. Same shape as
`src/db/prune-tokens.ts`: standalone script, cutoff computed by Postgres rather
than Node, guarded to run only when invoked directly, covered by integration
tests.

### 5.5 Downstream

- `recommendations` reads `orders → listings` directly instead of joining
  through `order_items`.
- The seller dashboard filters on `seller_id`.
- `docs/security/rbac-matrix.md`, `docs/security/threat-model.md` and the
  Swagger spec all need updating, including a row for sellers buying.

## 6. Part 4 — Seller reviews

### 6.1 Schema

`reviews.listing_id` is replaced by:

```
seller_id  → users  (cascade)   -- the subject
order_id   → orders (cascade)   -- the transaction, UNIQUE
```

`order_id` being unique matters beyond tidiness: the current duplicate check is
a `SELECT` followed by an `INSERT`, so two concurrent posts can both pass it. A
unique index makes one-review-per-transaction structural instead of hopeful.

`users` gains `review_count` and `rating_sum`, both integers, maintained in the
same transaction as the review write (D7).

### 6.2 Eligibility

```
orders.buyer_id = me
  AND orders.seller_id = subject
  AND orders.status = 'completed'
```

plus the unique constraint. That is the whole rule.

### 6.3 API

| Endpoint | Access |
|----------|--------|
| `POST /api/orders/[id]/review` | Buyer of that order, status `completed` |
| `GET /api/users/[id]/reviews` | Public, paginated |
| `PATCH`/`DELETE /api/reviews/[id]` | Author or admin; adjusts aggregates |
| ~~`GET`/`POST /api/listings/[id]/reviews`~~ | Removed |

Reviews are posted against the order because the order is the thing being
reviewed.

### 6.4 UI

- Listing detail: the review block becomes a seller card — name, avatar, stars,
  review count — linking to the seller profile.
- New `/users/[id]`: rating summary, review list, that seller's active listings.
- Order detail: a "Leave a review" affordance when the order is `completed` and
  unreviewed.
- `ListingReviews.tsx` → `SellerReviews.tsx`.

### 6.5 Migration

Runs after Part 3, since it needs `orders.listing_id`. `seller_id` comes from
the listing; `order_id` from the reviewer's earliest order for that listing. Any
review with no matching order is deleted and the count logged — under the old
eligibility rule none should exist, but seed data may disagree.

## 7. Testing

*Categories* — **unit:** path computation, cycle detection, depth cap, leaf-only
validation, as pure functions in `src/lib/categories.ts`. **Integration:**
re-parenting rewrites the subtree, filtering by a parent returns grandchildren's
listings, deleting a node with children is refused. **Component:** cascading
selects, tree filter, breadcrumb.

*Uploads* — a **shared contract suite run against both drivers**: the same tests
execute against `MemoryStorageProvider` and against `LocalStorageProvider` on a
temp directory, so the mock cannot drift from the real thing. **Unit:**
magic-byte sniffing against a table of genuine headers plus one polyglot; key
validation against traversal attempts. **Integration:** a non-owner gets
nothing, limits hold, re-encoded output carries no EXIF. **Component:** preview,
remove, reorder, and the create → upload → publish sequence, including the
failure path that leaves a draft.

*Lifecycle* — **unit:** `canTransition` over every state × state × actor
combination. **Integration:** two `Promise.all` orders on one listing asserting
exactly one 201 and one 409; lazy expiry; self-purchase 403; the listing-status
side effect of each transition.

*Reviews* — **unit:** the eligibility predicate and the aggregate arithmetic.
**Integration:** concurrent double-review yields one 201 and one 409; aggregates
survive insert, edit and delete.

**Cross-cutting.** `src/test/threat-model.test.ts` asserts the security docs cite
real files, so it breaks the moment routes move — every part updates it.
`rbac-matrix.md` and `rbac.integration.test.ts` need rows for uploads, category
writes, order transitions, review endpoints and sellers buying.
`src/test/factories.ts` needs new builders (a category tree, a listing with
images, an order in a given state); the existing order factory changes shape.
`src/test/fixtures/semantic-catalogue.ts` references categories. Swagger is
regenerated.

## 8. Migrations

Numbered from 0011, in dependency order:

| # | Contents | Reversible |
|---|----------|-----------|
| 0011 | Category tree columns, backfill roots, index | Yes |
| 0012 | `listing_images`, `draft` status, drop `image_url` | **No** — image links are lost |
| 0013 | Orders collapse, `reserved`/`expired` statuses, backfill, drop `order_items` | **No** — the join table is gone |
| 0014 | Reviews re-anchor, user aggregates, backfill | **Partly** — `listing_id` is derivable back through the order, but orphan reviews are deleted |

Data backfills are written as SQL inside the migration rather than as a Node
script, so they run in the same transaction as the DDL. Each migration carries
its reasoning in comments, following the convention set by 0006–0010.

The 0013 backfill splits any multi-item order into one order per item,
preserving `created_at` and status, and maps `approved`→`confirmed`,
`rejected`→`declined`, `paid`→`confirmed`. It is tested against a database
deliberately seeded with a multi-item order — the case production data may hold
and the current UI cannot produce.

## 9. Risks

1. **Part 3 is the sharp edge.** Twelve files, a data migration, and it
   invalidates a concept the SEC-12 threat model documents.
2. **`sharp` in the Docker build.** A native binary, the same class of problem
   as onnxruntime, with the same `serverExternalPackages` lever.
3. **Compose variables.** Part 2 adds two; the OAuth variables are currently
   missing from every compose file, which is a live example of the failure.
4. **`?categoryId=` changes meaning** for any existing API consumer.

## 10. Delivery order

Parts 1 and 2 are independent of everything and of each other. Part 3 stands
alone but touches the most. Part 4 needs Part 3.

```
Part 1 (categories) ─┐
                     ├─→ Part 3 (lifecycle) ─→ Part 4 (reviews)
Part 2 (uploads) ────┘
```

Each part becomes its own implementation plan.

## 11. Out of scope

- Payments. `paid` is being removed precisely because there is no payment
  integration; adding one is a separate project.
- A shopping cart. D1 removes multi-item orders; reintroducing them is a new
  design.
- Buyer reputation. Reviews are one-directional (D6).
- Moderation of reviews beyond the existing author-or-admin edit and delete.
- An S3 storage driver. D8 leaves the seam; building the driver is later work.
- The nine Important findings from the 2026-08-29 code review of the SEC epic.
  They remain separate work and are not addressed here.
