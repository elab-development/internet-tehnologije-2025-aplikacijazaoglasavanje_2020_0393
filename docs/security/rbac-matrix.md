# RBAC matrix — `iteh-c2c-ecommerce`

Every route under `src/app/api/**`, with the role it requires and the ownership rule
applied on top of that role. Produced by **C2C-SEC-10**; each row has at least one test
in `src/app/api/rbac.integration.test.ts`.

> **Why the ownership column exists.** `authorize("seller")` answers *"is this caller a
> seller?"* — necessary, and not sufficient. Whether they may edit *this* listing is a
> separate question that used to be answered ad hoc per route, or not at all. That is how
> `GET /api/listings` came to leak other sellers' `sold` and `removed` inventory: a
> filter that looked like a feature. The predicates in `src/lib/authorization.ts` make
> the second half one testable decision.

## Status-code conventions

| Situation | Response | Why |
|---|---|---|
| No credential presented | **401** | "Log in" — distinguishable by a client from "you cannot do this" |
| Authenticated, wrong role or not the owner | **403** | The caller exists and is refused |
| Not the owner, **and** a 403 would disclose existence | **404** | See below |
| Row genuinely absent | **404** | Identical body to the case above |

### Where 404 replaces 403

A 403 says *"this exists and is not yours."* For a sequential id that is an enumeration
oracle: walk the ids, collect the 403s, and you learn how many orders the system holds
and which are real. So a refusal hides existence when the id is **guessable** *and* the
resource is **private to one user**.

- **Applied** to `GET /api/orders/{id}` and `DELETE /api/auth/oauth/link/{provider}`.
  The body is byte-identical to the genuinely-missing case; a different message would
  reintroduce the oracle the status code just closed.
- **Not applied** to listings. A listing is a public object — confirming one exists
  discloses nothing that `GET /api/listings` does not already publish, and a 403 there is
  the more useful answer for the seller who mistyped an id.
- **Applied to `GET /api/images/{id}`, which looks like an exception to the listing rule
  above but isn't.** A `draft` or `removed` listing is *not* public — that is the whole
  point of those statuses — so an image id that resolves only for a non-published listing
  is itself information a stranger should not get from a 403. The route answers 404,
  byte-identical to a genuinely unknown image id, for both "doesn't exist" and "exists
  but its listing isn't published to you."

### Authorisation is decided before state

`PUT /api/orders/{id}` decides whether the caller is a party to the order before it
checks whether the transition they asked for is legal. The other order returns
`400 "Cannot move an order from completed to confirmed"` to a stranger, which is a fact
about someone else's purchase.

## The matrix

Legend: **—** public · **✓** permitted · **✗** refused

| Route | Method | Auth | buyer | seller | admin | Ownership rule |
|---|---|---|---|---|---|---|
| `/api/auth/register` | POST | — | ✓ | ✓ | ✓ | `role` is whitelisted to buyer/seller (SEC-1) |
| `/api/auth/login` | POST | — | ✓ | ✓ | ✓ | — |
| `/api/auth/logout` | POST | required | ✓ | ✓ | ✓ | Revokes the caller's own token family |
| `/api/auth/refresh` | POST | cookie | ✓ | ✓ | ✓ | Rotation is bound to the presented token |
| `/api/auth/me` | GET | required | ✓ | ✓ | ✓ | Always the caller's own record |
| `/api/auth/providers` | GET | — | ✓ | ✓ | ✓ | Names only; no client ids |
| `/api/auth/oauth/{provider}` | GET | — | ✓ | ✓ | ✓ | 404 when unknown *or* unconfigured |
| `/api/auth/oauth/{provider}/callback` | GET | — | ✓ | ✓ | ✓ | `state` must match the signed cookie |
| `/api/auth/oauth/link` | POST | link cookie | ✓ | ✓ | ✓ | Existing account's password re-auth (D9) |
| `/api/auth/oauth/link/{provider}` | DELETE | required | ✓ | ✓ | ✓ | Own link only → **404**; refuses the last credential → 409 |
| `/api/categories` | GET | — | ✓ | ✓ | ✓ | — |
| `/api/categories` | POST | required | ✗ | ✗ | ✓ | — |
| `/api/categories/{id}` | PUT · DELETE | required | ✗ | ✗ | ✓ | — |
| `/api/listings` | GET | optional | ✓ | ✓ | ✓ | Anonymous and non-owners see `active` only; a seller sees their own `sold`/`removed`; admin sees all |
| `/api/listings` | POST | required | ✗ | ✓ | ✓ | `sellerId` is taken from the token, never the body |
| `/api/listings/{id}` | GET | optional | ✓ | ✓ | ✓ | Published rows (`active`/`reserved`/`sold`) are public; `draft` and `removed` are owner-or-admin |
| `/api/listings/{id}` | PUT · DELETE | required | ✗ | owner | ✓ | `canMutateListing`; a **409** on any status change while the listing is `reserved` |
| `/api/listings/{id}/images` | POST | required | ✗ | owner | ✓ | `canMutateListing`; magic-byte sniffed, re-encoded, rate limited |
| `/api/listings/{id}/images` | PATCH | required | ✗ | owner | ✓ | `canMutateListing`; reorder is scoped to this listing's own image ids |
| `/api/listings/{id}/images/{imageId}` | DELETE | required | ✗ | owner | ✓ | `canMutateListing`; row deleted, then the object, best-effort |
| `/api/images/{id}` | GET | optional | ✓ | ✓ | ✓ | Public for a published listing (`active`/`reserved`/`sold`); owner or admin otherwise → **404**, not 403 (see below) |
| `/api/listings/{id}/similar` | GET | — | ✓ | ✓ | ✓ | Embeddings never leave the server |
| `/api/listings/generate-description` | POST | required | ✗ | ✓ | ✓ | Rate limited per **user id** (SEC-11) |
| `/api/orders` | GET | required | own | own | all | The caller's purchases, whatever their role — `buyerId = caller` |
| `/api/orders` | POST | required | ✓ | ✓ | ✓ | Anyone signed in may buy (D5); `buyerId` from the token; the listing's own seller gets **403** |
| `/api/orders/{id}` | GET | required | party | party | ✓ | `canViewOrder` — buyer or seller of *this* order; refusal is **404** |
| `/api/orders/{id}` | PUT | required | party | party | ✓ | `canTransition(from, to, actor)`; a non-party gets **404**, an illegal transition **400** |
| `/api/orders/{id}` | DELETE | required | ✗ | ✗ | ✓ | Releases the listing in the same transaction |
| `/api/orders/seller` | GET | required | ✗ | own sales | ✓ | Scoped to `orders.sellerId` |
| `/api/orders/{id}/review` | POST | required | buyer | buyer | ✗ | Buyer of *this* order, status `completed`. A non-party gets **404**; the seller and admins get **403** — reading an order is not a licence to write its buyer's opinion. One review per order, enforced by `reviews_one_per_order_idx` → **409** |
| `/api/recommendations` | GET | required | ✓ | ✓ | ✓ | Built from the caller's own history |
| `/api/reviews/{id}` | PATCH · DELETE | required | author | author | ✓ | `canMutateReview`; **not** the seller being reviewed. Both verbs adjust the seller's aggregates in the same transaction |
| `/api/users` | GET | required | ✗ | ✗ | ✓ | — |
| `/api/users/{id}/reviews` | GET | — | ✓ | ✓ | ✓ | Public. Name, avatar and the two rating integers only — `GET /api/users/{id}` stays `isSelfOrAdmin` |
| `/api/users/{id}` | GET | required | self | self | ✓ | `isSelfOrAdmin` |
| `/api/users/{id}` | PUT | required | self | self | ✓ | `isSelfOrAdmin`; `role` is admin-only even on your own record |
| `/api/users/{id}` | DELETE | required | ✗ | ✗ | ✓ | — |
| `/api/docs` | GET | — | ✓ | ✓ | ✓ | Swagger spec; no secrets |

## Invariants asserted across every route

1. **No response anywhere contains a password hash.** Checked by key name (`passwordHash`,
   `password_hash`) *and* by the bcrypt prefix `$2b$`, so a hash shipped under a new key
   name would still be caught.
2. **401 before 403.** An unauthenticated request never receives 403.
3. **Role is never read from a request body.** `sellerId` and `buyerId` come from the
   token; `role` on registration is whitelisted (SEC-1) and on OAuth creation is hard-coded
   to `buyer` (SEC-7).

## Known gaps

- **`DELETE /api/users/{id}`** cascades to listings, orders and reviews — and since Part 4,
  to reviews on both sides: the ones they wrote and the ones written about them. Deleting a
  seller erases their reputation along with them. Intended, destructive, no soft delete,
  deferred.
- **`GET /api/users/{id}/reviews` publishes a seller's display name and avatar to anyone.**
  That is what a marketplace profile is for (spec §6.4), and it is the reason the endpoint
  projects five columns by name rather than selecting the row. A `select *` there would
  publish the email address beside them; the route's own test asserts it does not.
- **`DELETE /api/users/{id}`** now also cascades to orders on both sides — a deleted
  seller takes their buyers' purchase records with them. Same disposition as the listing
  cascade above: intended, destructive, no soft delete, deferred.
- **Rate limiting is per-instance**, not distributed. Documented in SEC-11 and in the
  thesis deployment chapter rather than glossed over.
- **`POST /api/orders` is not rate limited, and nothing caps a buyer's concurrent
  reservations.** Placing an order now moves the listing to `reserved`, which removes it
  from browse for 48 hours; one self-registered account could therefore reserve the whole
  catalogue and hold it. An abuse control was never in this part's scope and the shape it
  should take — a limiter, a per-buyer cap, or both — is a product decision; deferred.
