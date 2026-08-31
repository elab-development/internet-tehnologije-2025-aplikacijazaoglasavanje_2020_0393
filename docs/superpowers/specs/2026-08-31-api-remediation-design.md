# API remediation — design

**Date:** 2026-08-31
**Status:** Approved design, not yet planned
**Input:** the API review of `develop` @ `f0c5164` — 33 findings (5 Critical, 7 High, 11 Medium, 10 Low)
**Scope:** all 33. The frontend is remediated separately and afterwards, except where a contract change here forces a call-site edit (D10).

---

## 1. Why

The API review found the core well defended and the edges thin. The reservation
claim, the order status graph and the review aggregates are built with real
transactions, compare-and-set and unique indexes as backstops. The defects
cluster in three places: perimeter controls that the security documents describe
as stronger than they are, a second tier of routes written to a visibly lower
standard, and validation that accepts values the database cannot represent.

Three findings are worth naming here because they set the priority of everything
else.

**The rate limiter can be bypassed with one header.** `getClientIp`
(`rate-limit.ts:135`) reads the left-most `X-Forwarded-For` entry — the one the
client writes. Every IP-keyed limit in the app keys on it: login, register,
refresh, both OAuth routes, account linking, image upload. Rotating the header
buys an unlimited budget. Worse, sending failed logins that carry a victim's
address locks that victim out. The project's own suite demonstrates the bypass
at `rate-limits.integration.test.ts:57`, where rotating the header is how a test
gets a fresh bucket.

**The sweep truncates other policies' windows.** `sweep()` filters every bucket
against the *calling* policy's window and fires every 500 calls globally
(`rate-limit.ts:20-26, 57-60`). Five hundred cheap hits on `/api/auth/refresh` —
a 5-minute window, and no cookie means no database work — prune the 1-hour
buckets down to 5 minutes. Register, AI generation and image upload drop from
10–30 per hour to 10–30 per five minutes. That is a 12× amplification of exactly
the bcrypt and Groq-quota floods those limits exist to stop.

**Money passes through a float.** `priceField` (`validation.ts:68`) rejects only
`NaN` and negatives. `parseFloat("1e400")` is `Infinity`, which passes both
checks and reaches a `numeric(10,2)` column as the string `"Infinity"`, which
PostgreSQL 14+ accepts. `1e9` instead overflows the column into a 500. And
`19.999` is silently rounded to `20.00` without telling the seller their price
changed.

---

## 2. Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | **Trust `X-Forwarded-For` only through a configured hop count, taking `entries[length - hops]`** | Each proxy appends the address it was talking to, so with `hops` trusted proxies the client sits at `length - hops`. A client-sent prefix is ignored by construction. Not `length - 1 - hops`: with one proxy setting `XFF: "client"` that index is −1. |
| D2 | **`TRUSTED_PROXY_HOPS` defaults to 0, and at 0 the IP-keyed limits are skipped rather than collapsed** | The image runs both behind Railway's edge and as bare compose with port 3000 published. Defaulting to 0 fails closed. Collapsing every caller into one shared bucket would be worse than no limit at all — one abuser would lock out every user. |
| D3 | **Per-account keys alongside the IP key on login and register; `user:<sub>` on authenticated routes** | The only identity that survives IP rotation, and the only protection that works at all under D2's `hops=0`. Either key may block. |
| D4 | **Each bucket carries its own `windowMs` and is swept against it** | Removes the cross-policy amplification without changing the exported API. |
| D5 | **Money is validated as a decimal string and handed to Postgres as a string** | Rejects non-finite, bounds to the column's real range, and rejects more than two decimal places with a message instead of quietly rounding a seller's price. Never round-trips through a float. |
| D6 | **Email lowercased in the schema, with a unique index on `lower(email)`; the migration refuses to run on a collision** | Makes the invariant structural rather than a convention. Refusing loudly with the offending addresses is what `0015` and `0017` already do. |
| D7 | **`DELETE /api/listings/{id}` soft-deletes to `removed` when order history exists, and hard-deletes otherwise** | `PUBLIC_LISTING_STATUSES` is already `["active", "reserved", "sold"]`, so `removed` is already invisible to every public read. The seller gets what they want without `RESTRICT` destroying a buyer's order history. |
| D8 | **One `FOR UPDATE` row lock on the listing closes all three upload races** | The sort-order read-then-write, the image-count TOCTOU and the write-ordering problem are one serialisation problem. Uploads to different listings do not contend. |
| D9 | **A password change revokes every refresh family; `currentPassword` is required for a self-change only** | An admin resetting a compromised account does not know the current password, and requiring it would break the case the feature exists for. |
| D10 | **A contract change carries its frontend call-site edits in the same group** | `PUT`→`PATCH` and `currentPassword` break existing callers. Splitting them across the API and frontend passes would leave the tree broken at a group boundary, which defeats the point of grouping. No dual-verb transition period: there are no external clients. |

---

## 3. Group 1 — Caller identity and rate limiting

### 3.1 Client IP

New `src/lib/client-ip.ts`. `getClientIp` leaves `rate-limit.ts`.

```
trustedProxyHops(): number      // TRUSTED_PROXY_HOPS, parsed strictly, default 0
clientIdentity(request): { kind: "ip"; value: string } | { kind: "untrusted" }
```

The header is a comma-separated list that grows by one entry per proxy, each
appending the address it received the connection from. With `hops` trusted
proxies in front of the app, the client is at `entries[entries.length - hops]`.

| Topology | `hops` | Header received | Index | Result |
|---|---|---|---|---|
| client → P1 → app | 1 | `client` | 0 | `client` |
| client → P1 → P2 → app | 2 | `client, P1` | 0 | `client` |
| Client sends their own XFF, one real proxy | 1 | `spoofed, client` | 1 | `client` — the spoofed prefix is ignored |
| No proxy | 0 | anything | — | `untrusted` |
| Header shorter than configured | 1 | *(absent)* | < 0 | `untrusted` |

`x-real-ip` is consulted only when `hops >= 1`, on the same trust basis.

### 3.2 What `untrusted` means

`clientIdentity` returning `untrusted` means the caller's address is not
knowable, and the IP-keyed limit is **skipped** — the request proceeds and no
`X-RateLimit-*` headers are emitted for that policy. Per-account limits (§3.3)
still apply and are what protects the app in this topology.

The app logs one line at startup when `TRUSTED_PROXY_HOPS` is 0, naming the
trade-off, so a production deployment that forgot to set it is visible rather
than silently weaker.

### 3.3 Per-account keys

Login and register check two keys and block if **either** is exhausted:

- `login:ip:<addr>` / `register:ip:<addr>` — skipped when untrusted
- `login:email:<normalised>` / `register:email:<normalised>` — always applied

The email key is normalised through the same lowercasing as D6, so
`A@x.com` and `a@x.com` share a bucket.

Authenticated rate-limited routes (image upload, AI generation) key on
`user:<sub>` **instead of** the IP key, not alongside it. The subject is already
authenticated, so it is both strictly more precise than an address and
unspoofable; keeping the IP key beside it would only reintroduce the shared-NAT
lockout that D2 exists to avoid. Account creation is itself rate-limited, so
minting identities to widen the budget is bounded by Group 1's own register key.

### 3.4 The sweep

`buckets` becomes `Map<string, { windowMs: number; hits: number[] }>`. `sweep`
filters each bucket against its own stored `windowMs`. `rateLimit` writes the
policy's `windowMs` when it creates or updates a bucket. The exported signature
of `rateLimit`, `rateLimitHeaders`, `resetRateLimits` and every policy constant
is unchanged.

### 3.5 Also in this group

- Login and register emit the full `rateLimitHeaders()` trio like the other six
  routes, instead of a bare `Retry-After`. *(Low)*
- `threat-model.md` T7 is rewritten to describe the limiter as it will then be,
  naming the per-instance limitation and no longer implying protections the
  code did not have. *(Medium — document honesty)*

---

## 4. Group 2 — Validation and money

### 4.1 Price

`priceField` accepts a string or a number and validates the **decimal
representation**:

- reject non-finite (`Infinity`, `NaN`) explicitly
- reject negative
- reject more than two decimal places with `"price may have at most 2 decimal places"` — do not round
- reject above the `numeric(10,2)` ceiling (`99999999.99`) with a message, rather than letting the column overflow into a 500
- return the canonical string form, so the value reaches Postgres without a float round-trip

### 4.2 Email

`RegisterBodySchema.email` gains `.trim().toLowerCase()`. A migration adds a
unique index on `lower(email)` and lowercases existing rows, raising with the
offending addresses if that would collide (§11). The register route catches the
unique violation through the existing `isUniqueViolation` helper in
`src/db/pg-errors.ts` and answers **409** instead of 500.

The OAuth callback's `eq(users.email, profile.email)` lookup normalises the
provider's address the same way before comparing, which is the reason the casing
bug matters: today a provider returning `A@x.com` misses an existing `a@x.com`
and creates a second account.

### 4.3 Token payload

`verifyToken` (`auth.ts:85`) parses the decoded payload through a Zod schema
instead of `as unknown as TokenPayload`. Every authorization predicate
downstream trusts that cast; it holds today only because `signToken` is the sole
issuer. This is the one place in an otherwise strict codebase where an illegal
state is representable and unchecked.

### 4.4 Shared parsing

`src/lib/params.ts` gains `parseBoundedInt(raw, { fallback, max })`. The four
drifting copies collapse into it: `similar/route.ts:173`,
`recommendations/route.ts:228`, `users/[id]/reviews/route.ts:171`,
`listings-query.ts:143`. Two are byte-identical including the comment; the
fourth uses the exact `parseInt(...) || default` idiom the others' comments warn
against.

### 4.5 Search wildcards

`listings-query.ts:202` escapes `%` and `_` in the user's search term before
building the `LIKE` pattern. Today a search for `50%` matches every listing.

---

## 5. Group 3 — Uploads

### 5.1 The size gate

`images/route.ts:103` reads `Number(request.headers.get("content-length"))`.
`Number(null)` is `0` — finite and under the cap — so a body with no
`Content-Length` passes the guard and `request.formData()` buffers it whole. A
chunked multipart body has no `Content-Length`, and the App Router imposes no
cap of its own.

A missing or non-numeric `Content-Length` becomes **411 Length Required**. A
value over the cap stays 413.

### 5.2 Write order

Today: `storage.put()` then `insertImage()`. A failed insert leaves an
**untracked** orphan — no row, so nothing can enumerate it. The DELETE handler
makes this exact point about the cascade (`listings/[id]/route.ts:455`).

Reversed: the row is inserted first, then the object written. Two systems cannot
be atomic, so this does not remove the failure — it converts it into one that is
*detectable and repairable*, a row pointing at a missing object, which a sweep
can find. That is the argument, and it should be stated that way rather than as
a claim of atomicity.

### 5.3 The three races, and one lock

`nextSortOrder` (`listing-images.ts:37`) is a read-then-write, so two concurrent
uploads collide and the cover image becomes whichever id sorts first. The
image-count cap is a TOCTOU with no database constraint behind it. Both, and the
ordering above, are one serialisation problem.

Inside a transaction:

1. `SELECT … FROM listings WHERE id = $1 FOR UPDATE`
2. count existing images, reject over the cap
3. compute the next sort order
4. insert the row
5. write the object; a failure rolls the transaction back

Uploads to the same listing serialise; uploads to different listings do not
contend. A unique index on `(listing_id, sort_order)` is added as the backstop —
the lock makes it correct, the index makes the collision unrepresentable, which
is how the reservation claim and the one-review-per-order rule are already
built.

### 5.4 Extraction

The content-length gate, formData parsing, byte sniffing and the whole sharp
decode/rotate/resize/re-encode pipeline sit inline in `POST`
(`images/route.ts:97-157`). `processUploadedImage(bytes)` moves to `src/lib/` and
is unit-tested directly, the way `sniffImageType` already is. Today it can only
be exercised through a slow integration test carrying real image bytes.

### 5.5 Also in this group

- A storage I/O error in `images/[id]/route.ts:90` stops being reported as 404,
  so a broken mount is distinguishable from a deleted image. *(Low)*

---

## 6. Group 4 — Auth and session integrity

### 6.1 OAuth account creation

`oauth/[provider]/callback/route.ts:209-227` writes the `users` row and the
`oauth_accounts` link as two separate statements. If the second fails, a
passwordless account owns that email; the next callback returns `needs_link` and
asks for a password that is `null`. The account is permanently unreachable.

Both writes move into one transaction.

### 6.2 Password change

`users/[id]/route.ts:206` is a bare
`updates.passwordHash = await hashPassword(password)` with nothing else touched.
Two changes:

- **Revoke every refresh family for that user in the same transaction**, through
  the existing `revokeRefreshTokenFamily`. The standard remediation after a
  compromise currently leaves the attacker's 30-day refresh token live.
- **`currentPassword` is required when the caller is changing their own
  password**, verified against the stored hash before anything is written, and
  **not** required when an admin changes another user's (D9). An account with no
  password — OAuth-only — is exempt from the requirement, since there is nothing
  to verify against.

`UpdateUserSchema` gains the optional field; the route enforces the conditional
requirement, because the condition depends on the authenticated caller and not
on the body.

### 6.3 Also in this group

- `safeReturnTo`'s regex (`oauth/return-to.ts:28`) is fixed. `/[ -\s]/` parses as
  the set `{space, literal hyphen, whitespace}`, so it rejects ordinary paths
  like `/link-account` while accepting one prefixed with a control character. It
  fails closed today, so this is hygiene — but the tests cover only tab and
  newline, which the pattern would match anyway, so they do not demonstrate what
  they claim. New tests cover the full control-character range and
  `/link-account`. *(Low)*
- Two optional-auth routes use `catch {}`, which treats a missing `JWT_SECRET`
  as "anonymous visitor". A third route gets this right and is the pattern to
  copy. *(Low)*
- `auth/login/route.ts:131` logs the driver error, which carries the bound email
  into the log. *(Low)*
- `/api/auth/providers` gets its first test — the only route with zero coverage.
  *(Low)*

---

## 7. Group 5 — Listing and order lifecycle

### 7.1 Listing deletion

`DELETE /api/listings/{id}` currently issues `db.delete(listings)` with nothing
catching the `RESTRICT` foreign key on `orders.listing_id`
(`listings/[id]/route.ts:457`). One cancelled order makes a listing permanently
undeletable behind an opaque 500.

Per D7, the handler first checks for any order referencing the listing:

- **No orders** — hard delete exactly as today, including reading the image rows
  before the cascade and the best-effort object cleanup after.
- **Any order** — set `status = 'removed'` and return 200 with a body stating
  the listing was withdrawn rather than deleted, and why. The images are **not**
  cleaned up on this branch: the listing row still exists and the buyer's order
  still links to it.

`removed` is already outside `PUBLIC_LISTING_STATUSES`, so the listing
disappears from every public read path without further change.

### 7.2 The `/similar` draft leak

`similar/route.ts:92` never checks the source listing's status. A stranger gets
404 for a non-existent id but 200 with neighbours for a draft — confirming it
exists and disclosing what it is about through its nearest neighbours. This
directly contradicts the RBAC matrix, which lists `/similar` as flatly public
while also claiming `draft` and `removed` are owner-or-admin.

The route applies `isPubliclyVisible` plus the owner/admin check and answers
404, exactly as `/api/images/{id}` does.

### 7.3 Expired reservations

`expires_at` appears in no comparison on the transition path. A seller can
confirm an order that lapsed a week ago, and whether they can depends entirely
on whether the scheduled sweep has run — which contradicts decision D4 of the
redesign spec, whose own claim is that correctness does not depend on the sweep.

The `pending → confirmed` transition gains `AND expires_at > now()` in its
conditional update, so a lapsed reservation cannot be confirmed regardless of
sweep timing.

### 7.4 Category tree guards

`wouldCreateCycle`, `subtreeHeight` and `hasListings`
(`categories/[id]/route.ts:154-179`) all run on the module-level client before
the transaction opens. Two concurrent admin moves can each pass against stale
paths and produce a cycle the database has no constraint against.

The reads move inside the transaction with `FOR UPDATE` on the node and its
prospective parent.

### 7.5 Stranded sold listings

`releaseUnheldListings` (`db/orders.ts:93`) only touches listings in `reserved`.
Delete a confirmed order and its listing stays `sold` forever — permanently
unbuyable, with no order left to explain why. It learns to release from `sold`
as well when no live order remains.

---

## 8. Group 6 — API surface consistency

### 8.1 Pagination

`listings-query.ts:206-213` orders by `createdAt` or `price` with no `id`
tiebreaker, while `orders/seller` and `users/{id}/reviews` both add one
explicitly for this reason. Two listings sharing a timestamp — or a price, under
`sort=price_asc` — can shuffle between requests, so a row falls through the gap
between pages or appears on both. `.id` is appended to every `orderBy` branch.

`GET /api/orders`, `GET /api/orders/seller` and `GET /api/users` have no `page`
or `limit` on their admin branches and return whole tables. All three take the
envelope `GET /api/listings` already defines, rather than inventing a fourth
shape.

### 8.2 Verbs and status codes

`categories/[id]`, `listings/[id]` and `users/[id]` accept "at least one field"
under `PUT`; `reviews/[id]` does the same under `PATCH`. The three become
`PATCH`. Per D10 the frontend's `api.put` call sites change in this group.

An illegal lifecycle transition returns 400 (`orders/[id]/route.ts:252`) while
two sibling conflicts in the same handler return 409 (`:285`, `:293`). The
illegal-transition case becomes 409 — it is a conflict with the resource's
current state.

Every 201 gains a `Location` header.

### 8.3 Swagger

Every changed verb, status code, request field and response envelope is
reflected in the JSDoc the spec is generated from. `npm run prebuild`
regenerates `src/lib/swagger-spec.json`.

---

## 9. Group 7 — Deployment, documents and tooling

### 9.1 Response headers

`next.config.ts` gains a `headers()` block: `Strict-Transport-Security`,
`Referrer-Policy`, `X-Content-Type-Options`, and `frame-ancestors`. The threat
model's limitations table currently lists only the missing CSP.

### 9.2 Compose

`POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}` becomes `:?` — matching what
`JWT_SECRET` already does correctly in the same file — and the host port mapping
is dropped from the production compose file. The weaker default is currently the
one guarding the data.

`TRUSTED_PROXY_HOPS` is documented in the README and the env example, and set to
`1` in Railway's variables (§12).

### 9.3 Documents

- `threat-model.md` T7 — rewritten (§3.5).
- `threat-model.md` T4 — the proof claim narrowed to the control-character
  coverage the predicate actually has, once §6.3 has widened it.
- `threat-model.md` §4 — the password-change gap removed from the limitations
  table once §6.2 has closed it.
- `rbac-matrix.md` — the `/similar` row corrected, and the `/orders/seller` row
  amended to state that it projects `buyerEmail`.
- The existing test asserting these documents cite real files is extended to pin
  the corrected claims, so they cannot drift back.
- Migration `0013` is not fixable — it is applied and the data is gone. It earns
  a paragraph in the thesis contrasting it with `0015` and `0017`, which
  `RAISE NOTICE` before every deletion.

### 9.4 Tooling

A repo-specific ESLint config encodes the conventions currently held by
discipline across 29 routes: the error-logging shape, and no raw `<img>` without
the disable comment. `db/orders.integration.test.ts:308` replaces its fixed
250 ms sleep with the same deterministic barrier used elsewhere in the suite.

---

## 10. Testing

Every security guard added or changed gets the **deliberate-break** check:
remove the guard, watch the *named* test fail, restore it. That is what caught
the non-falsifiable tests earlier in this project, and a guard whose test still
passes without it is not a guard.

### 10.1 New unit tests

| Subject | What must fail without the fix |
|---|---|
| `clientIdentity` | The hop arithmetic for each row of §3.1's table, including the spoofed-prefix case and `hops=0` returning `untrusted` |
| `priceField` | `"1e400"`, `1e9`, `19.999`, `"-0.01"`, and `"12.34"` surviving unrounded |
| `parseBoundedInt` | Each of the four call sites' previous behaviour, including the `parseInt` prefix-tolerance the old idiom had |
| `safeReturnTo` | `/link-account` accepted; the full control-character range rejected |
| `verifyToken` | A payload missing `sub`, `email` or `role`, and one with a `role` outside the enum |
| `processUploadedImage` | Decode, rotate, resize and re-encode, directly on bytes |
| Search escaping | `50%` matching only listings containing `50%` |

### 10.2 New integration tests

| Subject | What must fail without the fix |
|---|---|
| **Sweep isolation** | A flood against the 5-minute refresh policy must not shorten a 1-hour policy's window — the direct regression test for the 12× amplification |
| Per-account login key | Exhausting `login:email:` blocks even when the IP key is fresh |
| Untrusted identity | With `hops=0`, an IP-keyed policy does not block and emits no `X-RateLimit-*` |
| Listing soft-delete | A listing with a cancelled order returns 200, becomes `removed`, keeps its images, and stays reachable from the buyer's order |
| Listing hard-delete | A listing with no orders is still fully deleted, objects included |
| `/similar` on a draft | 404 for a stranger, 200 for the owner and for an admin |
| Expired reservation | `pending → confirmed` refused on a lapsed order, with the sweep never run |
| Concurrent category moves | Two simultaneous moves cannot produce a cycle |
| Sold-listing release | Deleting a confirmed order returns its listing to `active` |
| Password change | Every refresh family revoked; a self-change without `currentPassword` rejected; an admin change without it accepted |
| Registration casing | `A@x.com` after `a@x.com` returns 409, not a second account |
| Concurrent registration | Two simultaneous identical registrations produce one 201 and one 409, never a 500 |
| Upload races | Concurrent uploads to one listing produce distinct sort orders and respect the cap |
| Upload without `Content-Length` | 411, and the body is never buffered |
| Admin pagination | All three collections honour `page` and `limit` |

### 10.3 Existing tests that must change

`rate-limits.integration.test.ts:57` currently rotates `X-Forwarded-For` to get a
fresh bucket. That technique stops working by design. The file is rewritten to
use `resetRateLimits()` between cases, and the old technique becomes its own
test asserting that rotation **no longer** grants a fresh budget.

---

## 11. Migrations

Two. `0018` is the current head of `drizzle/meta/_journal.json`, so these take
`0019` and `0020`, in that order — the email index is a Group 2 precondition and
lands first.

**`0019_users_email_lower.sql`**

1. `RAISE EXCEPTION` listing every address for which
   `SELECT lower(email) FROM users GROUP BY 1 HAVING count(*) > 1` returns a row.
   The migration refuses rather than choosing a winner.
2. `UPDATE users SET email = lower(email) WHERE email <> lower(email)`, with a
   `RAISE NOTICE` of the count.
3. `CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email))`.

**`0020_listing_images_sort_order.sql`**

1. `RAISE NOTICE` for any `(listing_id, sort_order)` duplicate found.
2. Renumber duplicates deterministically by `id`.
3. `CREATE UNIQUE INDEX listing_images_listing_sort_idx ON listing_images (listing_id, sort_order)`.

Both get an entry in `drizzle/meta/_journal.json`. The migrator applies
migrations from the journal, not by globbing `drizzle/*.sql` — a file with no
journal entry silently never runs.

---

## 12. Operational gates

Two things must happen outside the code, and neither can be done from this
session.

**Check the email data before the migration ships.** The migration is designed
to refuse rather than guess, so it must be run against known data:

```sql
SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
```

An empty result means it applies cleanly. A non-empty one means those accounts
are resolved by hand first.

**Set `TRUSTED_PROXY_HOPS=1` in Railway's variables at deploy time.** Left
unset it defaults to 0, which is safe but silently disables IP-keyed limiting in
production — protection quietly weaker than intended, which is the failure mode
Group 1 exists to remove. The startup log line makes it visible, but the
variable still has to be set.

---

## 13. Delivery order

Branch: `feature/api-remediation` off `develop`.

| # | Group | Findings | Why here |
|---|-------|----------|----------|
| 1 | Caller identity and rate limiting | C1, C2, 1 Low (+ T7 correction) | Two Criticals, and the rest of the app's limits depend on the key being trustworthy |
| 2 | Validation and money | C4, H2, + 3 Medium/Low | A Critical, and D6's normalisation is a precondition for Group 1's email key |
| 3 | Uploads | C5, H4, + 2 Medium/Low | A Critical; one lock resolves three findings at once |
| 4 | Auth and session integrity | H1, H6, + 4 Low | The account-bricking race and the compromise-remediation gap |
| 5 | Listing and order lifecycle | C3, H5, + 3 Medium | The last Critical, and the draft leak |
| 6 | API surface consistency | H3, H7, + 2 Medium, 1 Low | Contract changes, so late enough that nothing else is still moving |
| 7 | Deployment, documents, tooling | 3 Medium, 2 Low (+ remaining doc corrections) | Documents corrected last, once they can describe what is true |

Four of the five Criticals land in the first three groups, so the exploitable
surface closes early even though the ordering is by subsystem rather than by
severity.

---

## 14. Traceability

Every finding, and where it is handled.

| Sev | Finding | Where | Group |
|---|---|---|---|
| C | Left-most `X-Forwarded-For` bypasses every IP limit | `rate-limit.ts:135` | 1 |
| C | Sweep truncates other policies' windows | `rate-limit.ts:20,57` | 1 |
| C | Money accepts `Infinity`, overflows, silently rounds | `validation.ts:68` | 2 |
| C | Upload size gate skipped without `Content-Length` | `images/route.ts:103` | 3 |
| C | Listing with any order cannot be deleted (500) | `listings/[id]/route.ts:457` | 5 |
| H | Registration never lowercases email; 500 on concurrent duplicate | `register/route.ts:111`, `validation.ts:82` | 2 |
| H | Upload writes object before row; sort-order race; count TOCTOU | `images/route.ts:159`, `listing-images.ts:37` | 3 |
| H | OAuth account creation is two uncoordinated writes | `oauth/[provider]/callback/route.ts:209` | 4 |
| H | Password change revokes no sessions | `users/[id]/route.ts:204` | 4 |
| H | `/similar` leaks the semantic content of drafts | `similar/route.ts:92` | 5 |
| H | Browse pagination has no `id` tiebreaker | `listings-query.ts:206` | 6 |
| H | Three admin collections return entire tables | `orders`, `orders/seller`, `users` | 6 |
| M | `verifyToken` trusts the JWT payload's shape | `auth.ts:85` | 2 |
| M | Duplicated numeric parsing with drifting rationale | 4 sites | 2 |
| M | Image processing is business logic stuck in a route | `images/route.ts:97` | 3 |
| M | Expired reservation is still confirmable | `orders/[id]`, `order-lifecycle.ts` | 5 |
| M | Category tree guards read outside their transaction | `categories/[id]/route.ts:154` | 5 |
| M | Deleting a confirmed order strands its listing as sold | `db/orders.ts:93` | 5 |
| M | `PUT` used for partial updates on three resources | 3 routes | 6 |
| M | Illegal transition returns 400 where siblings return 409 | `orders/[id]/route.ts:252` | 6 |
| M | No security response headers | `next.config.ts` | 7 |
| M | Compose defaults the database password, publishes the port | `docker-compose.yml:8,11` | 7 |
| M | Migration `0013` destroyed existing images | `drizzle/0013_*.sql` | 7 (documented, not fixed) |
| L | Search does not escape SQL wildcards | `listings-query.ts:202` | 2 |
| L | Rate-limit headers inconsistent on login and register | 2 routes | 1 |
| L | Storage I/O error reported as 404 | `images/[id]/route.ts:90` | 3 |
| L | `safeReturnTo`'s regex is not what its comment claims | `oauth/return-to.ts:28` | 4 |
| L | `catch {}` swallows non-auth errors in two routes | 2 routes | 4 |
| L | Login's 500 handler logs the bound email | `auth/login/route.ts:131` | 4 |
| L | `/api/auth/providers` has no test | — | 4 |
| L | No `Location` header on any 201 | every create route | 6 |
| L | A second fixed-sleep concurrency test | `db/orders.integration.test.ts:308` | 7 |
| L | No repo-specific ESLint rules | — | 7 |

---

## 15. Out of scope

- The frontend's own 30 findings. Remediated in a separate pass afterwards,
  except the call-site edits D10 pulls into Groups 4 and 6.
- Replacing the in-memory limiter with Redis. The scope note at
  `rate-limit.ts:5` is correct that this breaks under horizontal scaling; the
  deployment is a single container and the swap is a change of storage, not of
  design.
- A Content-Security-Policy. It needs a nonce strategy for Next's inline
  scripts, which is its own piece of work; §9.1 adds the four headers that do
  not.
- Chat, per backlog decision D7.
