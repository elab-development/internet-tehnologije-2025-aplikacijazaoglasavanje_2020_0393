# Order Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an order a reservation on one listing, with a status graph the code enforces, so two buyers can never buy the same second-hand object.

**Architecture:** `orders` absorbs the single item it always had; `order_items` is dropped. Placing an order claims the listing with a conditional `UPDATE … RETURNING`, making the double-sell unrepresentable rather than merely locked against. Reservations carry a 48-hour deadline that the reserve path itself enforces lazily, so correctness never depends on the sweep. The transition graph lives in one pure module, `src/lib/order-lifecycle.ts`, in the same shape as `authorization.ts`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle ORM, PostgreSQL, Zod, Vitest (projects: `unit`, `integration`, `component`), Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-30-listings-orders-reviews-categories-design.md` (Part 3, §5; decisions D1, D2, D3, D4, D5)

## Global Constraints

- **One order, one listing.** `order_items`, `quantity` and `orders.total_price` are removed. The price *is* the total.
- **`seller_id` is captured at order time** and denormalised onto the order deliberately (§5.1): the seller dashboard becomes a column filter, review eligibility becomes a single-table predicate, and a later listing edit cannot retroactively change who a past transaction was with.
- **Reservation is a conditional `UPDATE … RETURNING`.** Zero rows means someone else got there first — **409**. The order row is priced from the `RETURNING` values, never from anything the client sent.
- **`seller_id = buyer_id` is refused with 403** (D5). Sellers may buy; they may not buy from themselves.
- **Reservations expire after 48 hours** (D3), and **correctness does not depend on the sweep** (D4). The reserve path expires stale orders and releases their listings inside its own transaction, before it claims.
- **Every timestamp comes from Postgres**, never `new Date()`. The container clock and the host clock disagree on this project's dev machines; `defaultNow()`, `now()` and `make_interval` all read one clock.
- **Statuses:** `pending`, `confirmed`, `shipped`, `completed`, `cancelled`, `declined`, `expired`. `paid` is gone (no payment integration ever set it); `approved`/`rejected` become `confirmed`/`declined`.
- **Terminal states are `completed`, `declined`, `cancelled`, `expired`** — no transition leaves them, not even for an admin.
- **Only `completed` unlocks a review.** `src/lib/review-eligibility.ts` and `PURCHASED_ORDER_STATUSES` are deleted; the concept is one enum value.
- **Listing side effects ride in the same transaction as the status change.** → `confirmed` makes the listing `sold`; → `declined`/`cancelled`/`expired` returns it to `active`; → `shipped`/`completed` leave it alone.
- **`reserved` is a database status the API never accepts.** `UpdateListingSchema` keeps its four values; a seller cannot set or clear a reservation by hand.
- **404 over 403 on `/api/orders/{id}`**, for `PUT` as well as `GET`. Order ids are sequential; a 403 tells a prober the order exists.
- **The tree stays green after every task.** The destructive migration is the second-to-last task, exactly as Part 2 sequenced its column drop.
- **Run commands from `c2c-e-commerce/`**; paths beginning `docs/` are relative to the repo root.

## Deliberate deviations from the spec

Recorded here so a reviewer judges them rather than reporting them as drift.

1. **Migration numbers are 0014, 0015, 0016 — not the 0013 §8 predicts.** Part 2 consumed 0012 and 0013. The contents are unchanged; only the numbering moved.
2. **The collapse is three migrations, not one.** `ALTER TYPE … ADD VALUE` cannot *use* the new value in the same transaction that adds it, so `reserved` lands in its own file (0014) before the backfill that sets listings to it (0015). And the destructive half — `DROP TABLE order_items`, `DROP COLUMN total_price` — waits for 0016, after every consumer has moved, because dropping them in the additive migration would leave the tree broken between tasks. That is the defect that cost Part 1 a fix round.
3. **`canViewOrder` now admits the seller.** §5.1 puts `seller_id` on the order; §5.3 says the `PUT` route checks "the actor is a party to *this* order". The old rule excluded sellers because an order was a basket that could expose a buyer's *other* purchases. One order is now one listing the seller already sells, so the reason is gone and the rule follows the data. `canApproveOrder` is deleted — its `ownsListingInOrder` reconciliation no longer exists.
4. **`GET /api/listings/{id}` and `GET /api/images/{id}` share one visibility predicate, and `sold` becomes publicly viewable.** Today the detail route 404s a `sold` listing to everyone but its owner while the image route serves its photos — an inconsistency Part 2 flagged and deferred to here. After this part, confirming an order marks the listing `sold`, so leaving it as-is would make every completed purchase's listing unreachable from the buyer's own order page. `active`, `reserved` and `sold` are publicly visible; `draft` and `removed` stay owner-or-admin.
5. **A `reserved` listing cannot be edited into another status by its seller.** Not in §5, but a reservation is only meaningful if the seller cannot dissolve it by pressing "Disable" while a buyer waits.

---

## File Structure

**Create:**

| File | Responsibility |
|------|----------------|
| `src/lib/order-lifecycle.ts` | The status graph: statuses, actors, `canTransition`, listing side effects, the 48-hour constant. Pure. |
| `src/lib/order-lifecycle.test.ts` | Exhaustive state × state × actor unit tests |
| `src/db/orders.ts` | The SQL statements reservation and expiry are made of |
| `src/db/orders.integration.test.ts` | Those statements against a real database |
| `src/db/expire-reservations.ts` | The global sweep, `npm run db:expire-reservations` |
| `src/db/expire-reservations.integration.test.ts` | Its tests |
| `drizzle/0014_listing_reserved_status.sql` | Additive: `reserved` joins `listing_status` |
| `drizzle/0015_orders_collapse.sql` | Additive: new `order_status`, order columns, backfill, split multi-item orders |
| `drizzle/0016_drop_order_items.sql` | Destructive: drops `order_items` and `orders.total_price` |
| `src/db/schema/orders-collapse.integration.test.ts` | The 0015 backfill, including a deliberately multi-item order |
| `src/app/api/orders/route.integration.test.ts` | Reservation, the concurrent race, self-purchase, lazy expiry |
| `src/app/api/orders/[id]/route.integration.test.ts` | Every transition and its listing side effect |
| `src/components/orders/OrderActions.tsx` | The buttons a given actor may press on a given status |
| `src/components/orders/OrderActions.component.test.tsx` | Its tests |

**Modify:** `src/db/schema/orders.ts`, `src/db/schema/listings.ts`, `src/db/schema/index.ts`, `src/lib/validation.ts`, `src/lib/validation.test.ts`, `src/lib/authorization.ts`, `src/lib/authorization.test.ts`, `src/lib/listing-visibility.ts`, `src/lib/listing-visibility.test.ts`, `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/route.ts`, `src/app/api/orders/seller/route.ts`, `src/app/api/listings/[id]/route.ts`, `src/app/api/listings/[id]/reviews/route.ts`, `src/app/api/images/[id]/route.ts`, `src/app/api/recommendations/route.ts`, `src/app/api/recommendations/route.integration.test.ts`, `src/app/api/rbac.integration.test.ts`, `src/types/api.ts`, `src/components/ui/StatusBadge.tsx`, `src/components/orders/OrderCard.tsx`, `src/components/seller/SellerOrdersTab.tsx`, `src/app/(frontend)/orders/page.tsx`, `src/app/(frontend)/orders/[id]/page.tsx`, `src/app/(frontend)/listings/[id]/page.tsx`, `src/test/factories.ts`, `src/test/harness/factories.integration.test.ts`, `src/test/harness/test-db.integration.test.ts`, `scripts/generate-swagger.mjs`, `package.json`, `README.md`, `docs/security/rbac-matrix.md`, `docs/security/threat-model.md`

**Delete:** `src/db/schema/order-items.ts`, `src/lib/review-eligibility.ts`, `src/lib/review-eligibility.test.ts`

---

### Task 1: The status graph

The only module in this plan with no dependencies. Everything else consumes it.

**Files:**
- Create: `src/lib/order-lifecycle.ts`
- Test: `src/lib/order-lifecycle.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ORDER_STATUSES: readonly ["pending","confirmed","shipped","completed","cancelled","declined","expired"]`
  - `type OrderStatus = (typeof ORDER_STATUSES)[number]`
  - `type OrderActor = "buyer" | "seller" | "admin"`
  - `TERMINAL_ORDER_STATUSES: readonly OrderStatus[]`
  - `isTerminalStatus(status: OrderStatus): boolean`
  - `canTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean`
  - `listingStatusAfter(to: OrderStatus): "active" | "sold" | null`
  - `RESERVATION_HOURS = 48`

- [ ] **Step 1: Write the failing test**

Create `src/lib/order-lifecycle.test.ts`:

```ts
/**
 * Part 3 spec §5.3 — the status graph, exhaustively.
 *
 * ALLOWED is written out by hand rather than derived from the module under test: a test
 * that reads its expectations from the implementation asserts only that the
 * implementation equals itself.
 */
import { describe, expect, it } from "vitest";

import {
  ORDER_STATUSES,
  RESERVATION_HOURS,
  TERMINAL_ORDER_STATUSES,
  canTransition,
  isTerminalStatus,
  listingStatusAfter,
  type OrderActor,
  type OrderStatus,
} from "./order-lifecycle";

const ACTORS: OrderActor[] = ["buyer", "seller", "admin"];

/** Every legal (from, to, actor) triple in the spec's graph. Seventeen of 147. */
const ALLOWED: Array<[OrderStatus, OrderStatus, OrderActor]> = [
  // From pending: the seller confirms or declines, the buyer cancels.
  ["pending", "confirmed", "seller"],
  ["pending", "confirmed", "admin"],
  ["pending", "declined", "seller"],
  ["pending", "declined", "admin"],
  ["pending", "cancelled", "buyer"],
  ["pending", "cancelled", "admin"],
  // Expiry is a fact about the clock. Only an admin can assert it by hand.
  ["pending", "expired", "admin"],
  // From confirmed: the seller ships; either party can call the deal off.
  ["confirmed", "shipped", "seller"],
  ["confirmed", "shipped", "admin"],
  ["confirmed", "cancelled", "buyer"],
  ["confirmed", "cancelled", "seller"],
  ["confirmed", "cancelled", "admin"],
  // From shipped: the buyer confirms receipt; either party can still call it off.
  ["shipped", "completed", "buyer"],
  ["shipped", "completed", "admin"],
  ["shipped", "cancelled", "buyer"],
  ["shipped", "cancelled", "seller"],
  ["shipped", "cancelled", "admin"],
];

const isAllowed = (from: OrderStatus, to: OrderStatus, actor: OrderActor) =>
  ALLOWED.some(([f, t, a]) => f === from && t === to && a === actor);

describe("ORDER_STATUSES", () => {
  it("has dropped paid, approved and rejected", () => {
    expect(ORDER_STATUSES).not.toContain("paid");
    expect(ORDER_STATUSES).not.toContain("approved");
    expect(ORDER_STATUSES).not.toContain("rejected");
  });
});

describe("canTransition — every state x state x actor", () => {
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      for (const actor of ACTORS) {
        const expected = isAllowed(from, to, actor);
        it(`${actor}: ${from} -> ${to} is ${expected ? "allowed" : "refused"}`, () => {
          expect(canTransition(from, to, actor)).toBe(expected);
        });
      }
    }
  }
});

describe("canTransition — the rules the table encodes", () => {
  it("never lets a status transition to itself", () => {
    for (const status of ORDER_STATUSES) {
      for (const actor of ACTORS) {
        expect(canTransition(status, status, actor)).toBe(false);
      }
    }
  });

  it("lets nothing out of a terminal state, admin included", () => {
    for (const from of TERMINAL_ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        for (const actor of ACTORS) {
          expect(canTransition(from, to, actor)).toBe(false);
        }
      }
    }
  });

  it("refuses a buyer confirming their own purchase", () => {
    // Confirming your own order would let a buyer take the seller's decision for them.
    expect(canTransition("pending", "confirmed", "buyer")).toBe(false);
  });

  it("refuses a seller cancelling a pending order", () => {
    // A seller's refusal is `declined`, which is a different fact about the transaction.
    expect(canTransition("pending", "cancelled", "seller")).toBe(false);
  });

  it("refuses a buyer declining", () => {
    expect(canTransition("pending", "declined", "buyer")).toBe(false);
  });

  it("refuses buyer and seller marking an order expired", () => {
    expect(canTransition("pending", "expired", "buyer")).toBe(false);
    expect(canTransition("pending", "expired", "seller")).toBe(false);
  });

  it("refuses a seller marking an order completed", () => {
    // Receipt is the buyer's fact to report.
    expect(canTransition("shipped", "completed", "seller")).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("names the four the spec names", () => {
    expect([...TERMINAL_ORDER_STATUSES].sort()).toEqual(
      ["cancelled", "completed", "declined", "expired"].sort(),
    );
  });

  it("is false for the three live states", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("confirmed")).toBe(false);
    expect(isTerminalStatus("shipped")).toBe(false);
  });
});

describe("listingStatusAfter", () => {
  it("sells the listing on confirmation", () => {
    expect(listingStatusAfter("confirmed")).toBe("sold");
  });

  it("returns the listing to browse when the deal falls through", () => {
    expect(listingStatusAfter("declined")).toBe("active");
    expect(listingStatusAfter("cancelled")).toBe("active");
    expect(listingStatusAfter("expired")).toBe("active");
  });

  it("leaves the listing alone for shipping and completion", () => {
    // The listing is already `sold` by then; touching it again would be a lie about
    // when it sold.
    expect(listingStatusAfter("shipped")).toBeNull();
    expect(listingStatusAfter("completed")).toBeNull();
    expect(listingStatusAfter("pending")).toBeNull();
  });
});

describe("RESERVATION_HOURS", () => {
  it("is 48, per D3", () => {
    expect(RESERVATION_HOURS).toBe(48);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test:unit -- src/lib/order-lifecycle.test.ts`

Expected: FAIL — `Failed to resolve import "./order-lifecycle"`.

This module does not import the database schema, and its test does not either. The check that this list and the Postgres enum agree belongs with the migration that makes them agree, and Task 2 adds it there.

- [ ] **Step 3: Write the module**

Create `src/lib/order-lifecycle.ts`:

```ts
// ─── The order status graph ───────────────────────────────────────────────────
// Part 3 of the 2026-08-30 redesign (spec §5.3).
//
// The old enum had seven values, no transition graph, and two ways to say the same
// thing. Review eligibility keyed off a hand-maintained subset of it — a comment
// pretending to be a rule.
//
// This module is the rule. It is pure, in the same shape as `authorization.ts`: routes
// fetch the row and choose the status code, the decision itself lives here once, where
// every state x state x actor combination is a unit test rather than a database round
// trip.

/**
 * Every status an order can hold.
 *
 * `paid` is gone: no flow ever set it and there is no payment integration, so it has
 * only ever been a lie. `approved`/`rejected` are `confirmed`/`declined` — the same
 * facts under names that say who decided.
 *
 * `expired` is a seventh state on purpose. The complaint about the old enum was
 * overlapping meanings, not the count: telling a buyer their order was "cancelled" when
 * they cancelled nothing is exactly the overlap being removed.
 */
export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "completed",
  "cancelled",
  "declined",
  "expired",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The caller's relationship to *this* order — not their role.
 *
 * A seller who did not sell this listing is not "seller" here, they are not a party at
 * all. Routes resolve this with `orderActorFor` in `authorization.ts`.
 */
export type OrderActor = "buyer" | "seller" | "admin";

/** Statuses nothing transitions out of. */
export const TERMINAL_ORDER_STATUSES = [
  "completed",
  "cancelled",
  "declined",
  "expired",
] as const satisfies readonly OrderStatus[];

export function isTerminalStatus(status: OrderStatus): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly string[]).includes(status);
}

/** How long a reservation holds a listing before it lapses (D3). */
export const RESERVATION_HOURS = 48;

/**
 * The graph, as data.
 *
 * Read it as "from this state, this transition is available, and these are the parties
 * who may drive it". An admin may drive any transition that is *legal*, so they are not
 * listed: `canTransition` adds them. The empty array on `pending -> expired` is
 * therefore meaningful rather than redundant — the transition exists, and no ordinary
 * party may assert it, because expiry is a fact about the clock.
 *
 * Terminal states map to an empty object, which is what makes them terminal.
 */
const TRANSITIONS: Record<
  OrderStatus,
  Partial<Record<OrderStatus, readonly OrderActor[]>>
> = {
  pending: {
    confirmed: ["seller"],
    declined: ["seller"],
    // From pending the buyer cancels; the seller's refusal is `declined`, which says
    // something different about the transaction.
    cancelled: ["buyer"],
    expired: [],
  },
  confirmed: {
    shipped: ["seller"],
    // After acceptance a deal can fall through on either side.
    cancelled: ["buyer", "seller"],
  },
  shipped: {
    completed: ["buyer"],
    cancelled: ["buyer", "seller"],
  },
  completed: {},
  cancelled: {},
  declined: {},
  expired: {},
};

/** Whether `actor` may move an order from `from` to `to`. */
export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
): boolean {
  const parties = TRANSITIONS[from][to];
  // `undefined` means the edge does not exist; `[]` means it exists but only an admin
  // may drive it. Testing `!parties` rather than truthiness of length keeps those apart.
  if (parties === undefined) return false;
  return actor === "admin" || parties.includes(actor);
}

/**
 * What the listing becomes when an order reaches `to`, or null to leave it alone.
 *
 * The caller applies this inside the same transaction as the status change: a listing
 * whose reservation was released by a committed transaction that then failed to release
 * it is exactly the state this part exists to make impossible.
 */
export function listingStatusAfter(to: OrderStatus): "active" | "sold" | null {
  switch (to) {
    case "confirmed":
      return "sold";
    case "declined":
    case "cancelled":
    case "expired":
      return "active";
    // Shipping and completion say nothing new about availability: the listing has been
    // `sold` since the confirmation.
    case "pending":
    case "shipped":
    case "completed":
      return null;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit -- src/lib/order-lifecycle.test.ts`
Expected: PASS — 147 transition cases plus the rule cases.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Prove the graph test can fail**

Temporarily change `cancelled: ["buyer"]` to `cancelled: ["buyer", "seller"]` under `pending`.

Run: `npm run test:unit -- src/lib/order-lifecycle.test.ts -t "canTransition"`
Expected: FAIL — `seller: pending -> cancelled is refused`.

Restore the line and re-run; expected PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/order-lifecycle.ts src/lib/order-lifecycle.test.ts
git commit -m "feat(orders): the status graph as a pure module"
```

---

### Task 2: Schema and the additive migrations

The largest task, and the one that decides whether the rest of the plan can proceed one file at a time. It changes the shape of `orders` **without removing anything**: `order_items` and `orders.total_price` survive, so every consumer that still reads them keeps working while later tasks move them one by one.

**Files:**
- Create: `drizzle/0014_listing_reserved_status.sql`
- Create: `drizzle/0015_orders_collapse.sql`
- Create: `src/db/schema/orders-collapse.integration.test.ts`
- Modify: `src/db/schema/orders.ts` (whole file), `src/db/schema/listings.ts:20-25`, `src/db/schema/index.ts`, `src/lib/validation.ts`, `src/lib/validation.test.ts`, `src/test/factories.ts`, `src/components/ui/StatusBadge.tsx`, `src/components/seller/SellerOrdersTab.tsx`, `src/app/api/rbac.integration.test.ts`, `src/app/api/recommendations/route.integration.test.ts`

**Interfaces:**
- Consumes: `ORDER_STATUSES` from `@/lib/order-lifecycle` (Task 1).
- Produces:
  - `orders` row type gains `sellerId: number`, `listingId: number`, `price: string`, `expiresAt: Date`, `updatedAt: Date`; loses `totalPrice` **from the model** (the column survives in the database until 0016).
  - `listingStatusEnum` gains `"reserved"`.
  - `CreateOrderSchema` is now `z.object({ listingId: number })`.
  - `makeOrder(options: MakeOrderOptions): Promise<Order>` where `MakeOrderOptions = Partial<Pick<Order, "status" | "price">> & { buyerId?: number; sellerId?: number; listingId?: number; expiresAt?: Date }` — **`listingIds` is gone; one order is one listing**.

- [ ] **Step 1: Write the migration test first**

Create `src/db/schema/orders-collapse.integration.test.ts`:

```ts
/**
 * Part 3 spec §8 — the 0015 backfill, replayed on a database that has never seen it.
 *
 * The shared test database arrives fully migrated, so it cannot show what the migration
 * *did*. This starts its own container, applies 0000-0014, writes the pre-migration data
 * that matters — including a multi-item order the current UI cannot produce — and then
 * applies 0015 alone.
 *
 * It is the only test in the suite that starts a second container. That cost buys the
 * one thing an irreversible data migration needs and nothing else provides: evidence it
 * preserves what it claims to preserve.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ORDER_STATUSES } from "@/lib/order-lifecycle";
import { TEST_DB_IMAGE } from "@/test/db";

const MIGRATIONS = path.resolve(__dirname, "../../../drizzle");

const COLLAPSE = "0015_orders_collapse.sql";
const RESERVED = "0014_listing_reserved_status.sql";

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Applies one migration file the way Drizzle's migrator does: split on the breakpoint
 * marker, run every statement inside a single transaction.
 */
async function apply(client: Client, file: string): Promise<void> {
  const contents = readFileSync(path.join(MIGRATIONS, file), "utf8");
  const statements = contents
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)+$/.test(s));

  await client.query("BEGIN");
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`${file} failed: ${(err as Error).message}`);
  }
}

let container: StartedPostgreSqlContainer;
let client: Client;

beforeAll(async () => {
  container = await new PostgreSqlContainer(TEST_DB_IMAGE).start();
  client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();

  // Everything up to and including 0014 — the database as it stood before this part.
  for (const file of migrationFiles()) {
    await apply(client, file);
    if (file === RESERVED) break;
  }

  // ── Pre-migration data ──────────────────────────────────────────────────────
  await client.query(`
    INSERT INTO users (email, password_hash, name, role) VALUES
      ('seller-a@example.test', 'x', 'Seller A', 'seller'),
      ('seller-b@example.test', 'x', 'Seller B', 'seller'),
      ('buyer@example.test',    'x', 'Buyer',    'buyer')
  `);
  await client.query(`
    INSERT INTO categories (name, slug, path, depth) VALUES ('Bikes', 'bikes', '1', 0)
  `);
  await client.query(`
    INSERT INTO listings (title, description, price, status, seller_id, category_id) VALUES
      ('Road bike',  'Fast',  '500.00', 'active', 1, 1),
      ('Track pump', 'Solid', ' 30.00', 'active', 1, 1),
      ('Helmet',     'Safe',  ' 45.00', 'active', 2, 1),
      ('Pannier',    'Roomy', ' 60.00', 'active', 2, 1)
  `);

  // A single-line order in the old `approved` state.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at)
    VALUES (1, 3, '500.00', 'approved', now() - interval '10 days')
  `);
  await client.query(`
    INSERT INTO order_items (order_id, listing_id, price, quantity) VALUES (1, 1, '500.00', 1)
  `);

  // A two-line order: the shape production data may hold and the UI cannot produce.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at)
    VALUES (2, 3, '75.00', 'paid', now() - interval '5 days')
  `);
  await client.query(`
    INSERT INTO order_items (order_id, listing_id, price, quantity) VALUES
      (2, 2, '30.00', 1),
      (2, 3, '45.00', 1)
  `);

  // A live pending order, whose listing must come out of this `reserved`.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at)
    VALUES (3, 3, '60.00', 'pending', now())
  `);
  await client.query(`
    INSERT INTO order_items (order_id, listing_id, price, quantity) VALUES (3, 4, '60.00', 1)
  `);

  // An order with no lines at all. Nothing about it is recoverable.
  await client.query(`
    INSERT INTO orders (id, buyer_id, total_price, status, created_at)
    VALUES (4, 3, '0.00', 'cancelled', now() - interval '90 days')
  `);
  await client.query(`SELECT setval('orders_id_seq', 4)`);

  await apply(client, COLLAPSE);
}, 180_000);

afterAll(async () => {
  await client?.end().catch(() => {});
  await container?.stop();
});

describe("0015 — the status enum", () => {
  it("holds exactly the seven statuses the graph names", async () => {
    const { rows } = await client.query<{ label: string }>(`
      SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'order_status'
    `);

    expect(rows.map((r) => r.label).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it("keeps reserved on listing_status, added by 0014", async () => {
    const { rows } = await client.query<{ label: string }>(`
      SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'listing_status'
    `);

    expect(rows.map((r) => r.label)).toContain("reserved");
  });
});

describe("0015 — the status mapping", () => {
  it("maps approved to confirmed", async () => {
    const { rows } = await client.query(`SELECT status FROM orders WHERE id = 1`);
    expect(rows[0].status).toBe("confirmed");
  });

  it("maps paid to confirmed, because paid was never a state any flow reached", async () => {
    const { rows } = await client.query(`SELECT status FROM orders WHERE id = 2`);
    expect(rows[0].status).toBe("confirmed");
  });
});

describe("0015 — the multi-item split", () => {
  it("turns a two-line order into two orders", async () => {
    const { rows } = await client.query(`
      SELECT listing_id, price::text, seller_id, status, created_at
        FROM orders
       WHERE listing_id IN (2, 3)
       ORDER BY listing_id
    `);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ listing_id: 2, price: "30.00", seller_id: 1 });
    expect(rows[1]).toMatchObject({ listing_id: 3, price: "45.00", seller_id: 2 });
  });

  it("gives every split order the original's status and creation date", async () => {
    const { rows } = await client.query(`
      SELECT DISTINCT status, date_trunc('second', created_at) AS at
        FROM orders WHERE listing_id IN (2, 3)
    `);

    // One distinct pair: both halves inherited the same two facts.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("confirmed");
  });

  it("prices each order from its own line, not the order total", async () => {
    const { rows } = await client.query(`
      SELECT sum(price)::text AS total FROM orders WHERE listing_id IN (2, 3)
    `);

    expect(rows[0].total).toBe("75.00");
  });
});

describe("0015 — the columns", () => {
  it("captures the seller from the listing", async () => {
    const { rows } = await client.query(`SELECT seller_id FROM orders WHERE listing_id = 1`);
    expect(rows[0].seller_id).toBe(1);
  });

  it("gives every order a deadline 48 hours after it was placed", async () => {
    const { rows } = await client.query(`
      SELECT extract(epoch FROM (expires_at - created_at)) AS seconds
        FROM orders WHERE listing_id = 1
    `);

    expect(Number(rows[0].seconds)).toBe(48 * 60 * 60);
  });

  it("leaves no order without a listing", async () => {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM orders WHERE listing_id IS NULL`);
    expect(rows[0].n).toBe(0);
  });

  it("deletes the order that had no lines at all", async () => {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM orders WHERE id = 4`);
    expect(rows[0].n).toBe(0);
  });
});

describe("0015 — the listing backfill", () => {
  it("reserves a listing held by a live pending order", async () => {
    const { rows } = await client.query(`SELECT status FROM listings WHERE id = 4`);
    expect(rows[0].status).toBe("reserved");
  });

  it("leaves a listing whose orders are all settled alone", async () => {
    const { rows } = await client.query(`SELECT status FROM listings WHERE id = 1`);
    expect(rows[0].status).toBe("active");
  });
});

describe("0015 — what it deliberately does not do", () => {
  it("keeps order_items, so consumers can be migrated one at a time", async () => {
    const { rows } = await client.query(`
      SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'order_items'
    `);
    expect(rows[0].n).toBe(1);
  });

  it("keeps total_price, but stops requiring it", async () => {
    const { rows } = await client.query(`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'total_price'
    `);
    expect(rows[0].is_nullable).toBe("YES");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- src/db/schema/orders-collapse.integration.test.ts`
Expected: FAIL in `beforeAll` — `ENOENT` / no such file `0015_orders_collapse.sql`.

- [ ] **Step 3: Write migration 0014**

Create `drizzle/0014_listing_reserved_status.sql`:

```sql
-- Part 3 of the 2026-08-30 redesign — a listing can be held.
--
-- A listing between "someone has claimed this" and "the seller has decided" is neither
-- `active` nor `sold`. Without a name for that state the only way to stop a second buyer
-- is a lock, and a lock serialises the writes without preventing the second sale.
--
-- Alone in its own migration on purpose: Postgres refuses to *use* an enum value in the
-- same transaction that adds it, and 0015's backfill uses this one.

ALTER TYPE "listing_status" ADD VALUE IF NOT EXISTS 'reserved';
```

- [ ] **Step 4: Write migration 0015**

Create `drizzle/0015_orders_collapse.sql`:

```sql
-- Part 3 of the 2026-08-30 redesign — one order, one listing (D1).
--
-- `order_items` existed for a cart that was never built. One call site, `quantity` never
-- sent, and the join is where the authorisation complexity came from: the SEC-10
-- ownership bug lived in exactly that reconciliation.
--
-- ADDITIVE ON PURPOSE. `order_items` and `orders.total_price` survive this migration so
-- the tree keeps compiling while each consumer moves to the new columns. 0016 drops
-- them. Dropping them here would break every reader at once — the defect that cost
-- Part 1 a fix round.
--
-- The status change is a type swap rather than ALTER TYPE ... ADD VALUE, because
-- Postgres cannot drop an enum value at all and `paid`, `approved` and `rejected` must
-- not survive as reachable states.

CREATE TYPE "order_status_new" AS ENUM (
  'pending', 'confirmed', 'shipped', 'completed', 'cancelled', 'declined', 'expired'
);
--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN "listing_id" integer,
  ADD COLUMN "seller_id" integer,
  ADD COLUMN "price" numeric(10,2),
  ADD COLUMN "expires_at" timestamp,
  ADD COLUMN "updated_at" timestamp;
--> statement-breakpoint
-- Split every line beyond the first into an order of its own. The current UI cannot
-- produce a multi-line order; production data may hold one, and silently keeping only
-- its first line would lose a real transaction.
INSERT INTO "orders" (
  "buyer_id", "total_price", "status", "created_at",
  "listing_id", "seller_id", "price", "expires_at", "updated_at"
)
SELECT o."buyer_id", i."price", o."status", o."created_at",
       i."listing_id", l."seller_id", i."price",
       o."created_at" + interval '48 hours', o."created_at"
  FROM (
    SELECT "id", "order_id", "listing_id", "price",
           row_number() OVER (PARTITION BY "order_id" ORDER BY "id") AS rn
      FROM "order_items"
  ) i
  JOIN "orders"   o ON o."id" = i."order_id"
  JOIN "listings" l ON l."id" = i."listing_id"
 WHERE i.rn > 1;
--> statement-breakpoint
-- Fill the original rows from their first line. New rows inserted above cannot match:
-- their ids do not appear in order_items.
UPDATE "orders" o
   SET "listing_id" = f."listing_id",
       "seller_id"  = f."seller_id",
       "price"      = f."price",
       "expires_at" = o."created_at" + interval '48 hours',
       "updated_at" = o."created_at"
  FROM (
    SELECT DISTINCT ON (i."order_id")
           i."order_id", i."listing_id", i."price", l."seller_id"
      FROM "order_items" i
      JOIN "listings" l ON l."id" = i."listing_id"
     ORDER BY i."order_id", i."id"
  ) f
 WHERE o."id" = f."order_id";
--> statement-breakpoint
-- An order with no lines describes no transaction. Nothing can be recovered from it, and
-- every new column below is about to become NOT NULL.
DELETE FROM "orders" WHERE "listing_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "orders"
  ALTER COLUMN "status" TYPE "order_status_new"
  USING (
    CASE "status"::text
      WHEN 'approved' THEN 'confirmed'
      WHEN 'rejected' THEN 'declined'
      -- No flow ever set `paid`; anything holding it was approved and nothing else.
      WHEN 'paid'     THEN 'confirmed'
      ELSE "status"::text
    END
  )::"order_status_new";
--> statement-breakpoint
DROP TYPE "order_status";
--> statement-breakpoint
ALTER TYPE "order_status_new" RENAME TO "order_status";
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "orders"
  ALTER COLUMN "listing_id" SET NOT NULL,
  ALTER COLUMN "seller_id"  SET NOT NULL,
  ALTER COLUMN "price"      SET NOT NULL,
  ALTER COLUMN "expires_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint
-- RESTRICT, not CASCADE: deleting a listing somebody bought would delete the record of
-- the purchase. Listings leave the marketplace by status, never by DELETE.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_listing_id_listings_id_fk"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_seller_id_users_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Not dropped yet, but no longer required: new writers ignore it, old readers still see
-- what they wrote. 0016 removes the column.
ALTER TABLE "orders" ALTER COLUMN "total_price" DROP NOT NULL;
--> statement-breakpoint
-- The seller dashboard's entire query, now that it is a column filter.
CREATE INDEX IF NOT EXISTS "orders_seller_id_idx"
  ON "orders" ("seller_id", "created_at" DESC);
--> statement-breakpoint
-- The reservation path's two lookups: expire this listing's stale orders, then ask
-- whether anything pending still holds it.
CREATE INDEX IF NOT EXISTS "orders_listing_id_status_idx"
  ON "orders" ("listing_id", "status");
--> statement-breakpoint
-- Listings a live pending order is holding become `reserved`. Without this, every
-- in-flight purchase at deploy time would leave its listing back in browse, which is the
-- double-sell this part exists to close.
UPDATE "listings" SET "status" = 'reserved'
 WHERE "status" = 'active'
   AND EXISTS (
     SELECT 1 FROM "orders"
      WHERE "orders"."listing_id" = "listings"."id"
        AND "orders"."status"     = 'pending'
        AND "orders"."expires_at" > now()
   );
```

- [ ] **Step 5: Run the migration test**

Run: `npm run test:integration -- src/db/schema/orders-collapse.integration.test.ts`
Expected: PASS, all cases. Allow two to three minutes — it starts its own container.

If the `apply` helper reports a failure on 0015, read the message it prints: it names the file and the Postgres error, and every statement in the file is independently runnable against a `psql` session on the container.

- [ ] **Step 6: Update the Drizzle schema**

Replace `src/db/schema/orders.ts` entirely:

```ts
import { sql } from "drizzle-orm";
import { integer, numeric, pgEnum, pgTable, serial, timestamp } from "drizzle-orm/pg-core";

import { ORDER_STATUSES } from "@/lib/order-lifecycle";

import { listings } from "./listings";
import { users } from "./users";

/**
 * Derived from the graph rather than repeated beside it.
 *
 * The old file listed the seven values a second time with a comment asking the next
 * reader to keep them in sync, which is the arrangement that let `PURCHASED_ORDER_STATUSES`
 * drift into a rule nothing enforced.
 */
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  buyerId: integer("buyer_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  /**
   * Denormalised from the listing at order time, deliberately (spec §5.1).
   *
   * It turns the seller dashboard into a column filter instead of an ownership
   * reconciliation, makes review eligibility a single-table predicate, and means a later
   * listing edit cannot retroactively change who a past transaction was with.
   */
  sellerId: integer("seller_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  /** RESTRICT: deleting a bought listing would delete the record of the purchase. */
  listingId: integer("listing_id")
    .references(() => listings.id, { onDelete: "restrict" })
    .notNull(),
  /** Captured at order time. With one listing per order, the price is the total. */
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  /**
   * Superseded by `price` and removed in 0016. It stays in the model, nullable, only so
   * the four files that still read it keep compiling while each moves in its own task —
   * the seller route, both order pages and one test's direct insert.
   */
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }),
  status: orderStatusEnum("status").default("pending").notNull(),
  /**
   * When the reservation lapses (D3). Set from Postgres's clock at creation, never from
   * Node's: the container and the host disagree on this project's dev machines, and a
   * deadline read from the wrong one expires orders early or never.
   *
   * No default: an order without a deadline is a listing held forever, so the writer has
   * to say when.
   */
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
```

If `pgEnum` rejects the readonly tuple (`Type 'readonly [...]' is not assignable`), widen at the call site only — never by making `ORDER_STATUSES` mutable:

```ts
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]);
```

`total_price` is nullable in the model because 0015 made it nullable in the database. Removing it here instead would break `tsc` in four files at once — the failure mode this whole additive sequence exists to avoid.

In `src/db/schema/listings.ts`, add `reserved` to the enum:

```ts
export const listingStatusEnum = pgEnum("listing_status", [
  "draft",
  "active",
  // Claimed by a pending order and not yet decided. Set and cleared only by the order
  // lifecycle — `UpdateListingSchema` does not accept it, so a seller cannot dissolve a
  // buyer's reservation by editing the listing.
  "reserved",
  "sold",
  "removed",
]);
```

In `src/db/schema/index.ts`, replace the `ordersRelations` block (the `orderItems`/`orderItemsRelations` entries stay until Task 9):

```ts
export const ordersRelations = relations(orders, ({ one, many }) => ({
  buyer: one(users, {
    fields: [orders.buyerId],
    references: [users.id],
  }),
  seller: one(users, {
    fields: [orders.sellerId],
    references: [users.id],
  }),
  listing: one(listings, {
    fields: [orders.listingId],
    references: [listings.id],
  }),
  orderItems: many(orderItems),
}));
```

- [ ] **Step 7: Update validation**

In `src/lib/validation.ts`, add the import:

```ts
import { ORDER_STATUSES } from "@/lib/order-lifecycle";
```

and replace the whole `// ─── Orders ───` section (`OrderItemSchema`, `CreateOrderSchema`, the local `ORDER_STATUSES`, `UpdateOrderStatusSchema`) with:

```ts
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
```

In `src/lib/validation.test.ts`: change the import of `ORDER_STATUSES` to come from `@/lib/order-lifecycle`, and replace the `CreateOrderSchema` and `UpdateOrderStatusSchema` describes with:

```ts
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
```

```ts
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
```

- [ ] **Step 8: Update the order factory**

In `src/test/factories.ts`, replace `MakeOrderOptions` and `makeOrder`:

```ts
export type MakeOrderOptions = Partial<Pick<Order, "status" | "price">> & {
  buyerId?: number;
  /** Defaults to the listing's own seller, which is what a real order captures. */
  sellerId?: number;
  listingId?: number;
  /** Defaults to 48 hours from now. Pass a past date to make an order sweepable. */
  expiresAt?: Date;
};
```

```ts
export async function makeOrder(options: MakeOrderOptions = {}): Promise<Order> {
  const db = await getTestDb();

  const buyerId = options.buyerId ?? (await makeUser({ role: "buyer" })).id;
  const listingId = options.listingId ?? (await makeListing()).id;

  const [listing] = await db
    .select({ price: listings.price, sellerId: listings.sellerId })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!listing) throw new Error(`makeOrder: listing ${listingId} does not exist`);

  const [order] = await db
    .insert(orders)
    .values({
      buyerId,
      sellerId: options.sellerId ?? listing.sellerId,
      listingId,
      price: options.price ?? listing.price,
      // Removed in Task 9 along with the column. Written until then so the pages that
      // still display it do not show every order as $0.00 mid-plan.
      totalPrice: options.price ?? listing.price,
      status: options.status ?? "completed",
      // Node's clock rather than Postgres's, uniquely here: a test that wants a lapsed
      // reservation has to be able to pass a date, and mixing `sql` with a Date in one
      // optional argument buys nothing a factory needs.
      expiresAt:
        options.expiresAt ??
        new Date(Date.now() + RESERVATION_HOURS * 60 * 60 * 1000),
    })
    .returning();

  // Kept until 0016 drops the table: `GET /api/orders/[id]`, the seller route, the
  // recommendations query and review eligibility all still read it, and each moves in
  // its own task. Remove this write with the migration, not before.
  await db.insert(orderItems).values({
    orderId: order.id,
    listingId,
    price: order.price,
    quantity: 1,
  });

  return order;
}
```

Add to the imports at the top of the file:

```ts
import { RESERVATION_HOURS } from "@/lib/order-lifecycle";
```

- [ ] **Step 9: Fix the two callers that passed several listings**

In `src/app/api/rbac.integration.test.ts`, `orderFor` becomes:

```ts
  async function orderFor(seller: { id: number }, buyer: { id: number }) {
    const category = await makeCategory();
    const listing = await makeListing({ sellerId: seller.id, categoryId: category.id });
    // Pending: the route refuses to approve anything else, and that guard would
    // otherwise mask the authorisation decision under test.
    return makeOrder({ buyerId: buyer.id, listingId: listing.id, status: "pending" });
  }
```

and the two remaining `listingIds: [listing.id]` occurrences in that file become `listingId: listing.id`.

In `src/app/api/recommendations/route.integration.test.ts`, every `listingIds: [x]` becomes `listingId: x`. The one case that ordered two listings at once now places two orders, which is what a buyer would actually have done:

```ts
  it("AC3: every listing across several orders is excluded", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const bikes = inCluster("cycling");
    await makeOrder({ buyerId: buyer.id, listingId: bikes[0].id });
    await makeOrder({ buyerId: buyer.id, listingId: bikes[1].id });
    await makeOrder({ buyerId: buyer.id, listingId: bikes[2].id });

    const { body } = await recommend(authHeaderFor(buyer), "limit=20");
    const returned = body.data.map((r) => r.id);

    for (const bought of [bikes[0].id, bikes[1].id, bikes[2].id]) {
      expect(returned).not.toContain(bought);
    }
  });
```

The recency test near the end of that file inserts `orders` and `order_items` rows directly. Give the order insert the new columns; leave the `order_items` insert alone until Task 9:

```ts
      const [order] = await db
        .insert(orders)
        .values({
          buyerId: buyer.id,
          sellerId: cyclingSellerId,
          listingId: cycling.id,
          price: "10.00",
          totalPrice: "10.00",
          status: "completed",
          expiresAt: new Date(now - i * day * 0.25 + 48 * 60 * 60 * 1000),
          createdAt: new Date(now - i * day * 0.25),
        })
        .returning();
```

`cyclingSellerId` comes from the listing that test already has in hand — read it with `listings.sellerId` in the same query that fetches `cycling`, rather than assuming a value.

- [ ] **Step 10: Fix the two components `tsc` now rejects**

`src/components/ui/StatusBadge.tsx` — replace the two order maps:

```ts
const orderStatusClasses: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-green-100 text-green-700",
  shipped: "bg-indigo-100 text-indigo-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  declined: "bg-red-100 text-red-700",
  expired: "bg-zinc-100 text-zinc-500",
};
```

```ts
/** Buyer-facing wording for an order status. */
const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "Awaiting seller confirmation",
  confirmed: "Confirmed by seller",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Declined by seller",
  expired: "Reservation expired",
};
```

and add `reserved` to the listing map, between `active` and `sold`:

```ts
  reserved: "bg-amber-100 text-amber-700",
```

`src/components/seller/SellerOrdersTab.tsx` — the minimum that compiles; the tab is rewritten properly in Task 6. Rename the two statuses and the two toasts:

```ts
  async function handleStatusUpdate(
    orderId: number,
    newStatus: "confirmed" | "declined",
  ) {
```

```ts
      toast.success(
        `Order #${orderId} ${newStatus === "confirmed" ? "confirmed" : "declined"}`,
      );
```

```ts
                    onApprove={() => handleStatusUpdate(order.id, "confirmed")}
                    onReject={() => handleStatusUpdate(order.id, "declined")}
```

- [ ] **Step 11: Run everything**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm test`
Expected: PASS. The suite runs to completion in roughly six to eight minutes on this project — run it in the foreground, with no background flag, no monitor and no sleep-polling, and wait inside the call. A multi-minute wait is expected and correct.

- [ ] **Step 12: Prove the split test can fail**

In `drizzle/0015_orders_collapse.sql`, change `WHERE i.rn > 1` to `WHERE i.rn > 99`.

Run: `npm run test:integration -- src/db/schema/orders-collapse.integration.test.ts -t "turns a two-line order into two orders"`
Expected: FAIL — only one of listings 2 and 3 has an order.

Restore the line and re-run; expected PASS.

- [ ] **Step 13: Commit**

```bash
git add drizzle/0014_listing_reserved_status.sql drizzle/0015_orders_collapse.sql \
  src/db/schema/orders.ts src/db/schema/listings.ts src/db/schema/index.ts \
  src/db/schema/orders-collapse.integration.test.ts \
  src/lib/validation.ts src/lib/validation.test.ts src/test/factories.ts \
  src/components/ui/StatusBadge.tsx src/components/seller/SellerOrdersTab.tsx \
  src/app/api/rbac.integration.test.ts src/app/api/recommendations/route.integration.test.ts
git commit -m "feat(orders): collapse the item into the order

Additive: order_items and total_price survive so consumers can move one at a
time. 0016 drops them."
```

---

### Task 3: The reservation statements

The four SQL statements the reserve path and the sweep are both made of, in one file, so the lazy path and the scheduled path cannot drift apart.

**Files:**
- Create: `src/db/orders.ts`
- Test: `src/db/orders.integration.test.ts`

**Interfaces:**
- Consumes: `RESERVATION_HOURS` from `@/lib/order-lifecycle`; the `orders` and `listings` tables from `@/db/schema`.
- Produces:
  - `type OrderExecutor = Database | <transaction handle>`
  - `expireStalePendingOrders(x: OrderExecutor, listingId?: number): Promise<number>`
  - `releaseUnheldListings(x: OrderExecutor, listingId?: number): Promise<number>`
  - `claimListing(x: OrderExecutor, listingId: number): Promise<ClaimedListing | null>` where `ClaimedListing = { id: number; price: string; sellerId: number }`
  - `applyListingSideEffect(x: OrderExecutor, listingId: number, next: "active" | "sold"): Promise<void>`
  - `reservationDeadline(): Date`

- [ ] **Step 1: Write the failing test**

Create `src/db/orders.integration.test.ts`:

```ts
/**
 * Part 3 spec §5.2 and §5.4 — the statements reservation is made of.
 *
 * Each is tested on its own here, so a failure in the route's transaction points at the
 * route rather than at the SQL underneath it.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyListingSideEffect,
  claimListing,
  expireStalePendingOrders,
  releaseUnheldListings,
} from "@/db/orders";
import { listings, orders } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

const HOUR = 60 * 60 * 1000;
const past = (hours: number) => new Date(Date.now() - hours * HOUR);
const future = (hours: number) => new Date(Date.now() + hours * HOUR);

beforeEach(async () => {
  await resetDb();
});

async function statusOf(listingId: number): Promise<string> {
  const db = await getTestDb();
  const [row] = await db
    .select({ status: listings.status })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  return row.status;
}

describe("expireStalePendingOrders", () => {
  it("expires a pending order past its deadline", async () => {
    const db = await getTestDb();
    const order = await makeOrder({ status: "pending", expiresAt: past(1) });

    const count = await expireStalePendingOrders(db);

    expect(count).toBe(1);
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("expired");
  });

  it("leaves a pending order inside its deadline alone", async () => {
    const db = await getTestDb();
    const order = await makeOrder({ status: "pending", expiresAt: future(1) });

    expect(await expireStalePendingOrders(db)).toBe(0);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("pending");
  });

  it("never touches an order that is not pending, however old", async () => {
    // A confirmed order's deadline is meaningless — the seller already answered. Sweeping
    // it would cancel a live sale.
    const db = await getTestDb();
    const order = await makeOrder({ status: "confirmed", expiresAt: past(500) });

    expect(await expireStalePendingOrders(db)).toBe(0);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("confirmed");
  });

  it("scopes to one listing when given one", async () => {
    const db = await getTestDb();
    const mine = await makeListing();
    const theirs = await makeListing();
    await makeOrder({ listingId: mine.id, status: "pending", expiresAt: past(1) });
    const other = await makeOrder({
      listingId: theirs.id,
      status: "pending",
      expiresAt: past(1),
    });

    expect(await expireStalePendingOrders(db, mine.id)).toBe(1);

    const [row] = await db.select().from(orders).where(eq(orders.id, other.id));
    expect(row.status).toBe("pending");
  });
});

describe("releaseUnheldListings", () => {
  it("returns a reserved listing to browse when nothing pending holds it", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({ listingId: listing.id, status: "expired", expiresAt: past(1) });

    expect(await releaseUnheldListings(db)).toBe(1);
    expect(await statusOf(listing.id)).toBe("active");
  });

  it("leaves a reserved listing alone while a pending order holds it", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({ listingId: listing.id, status: "pending", expiresAt: future(1) });

    expect(await releaseUnheldListings(db)).toBe(0);
    expect(await statusOf(listing.id)).toBe("reserved");
  });

  it("never resurrects a draft, removed or sold listing", async () => {
    // The predicate is `status = 'reserved'`, not `NOT EXISTS(...)`. Without the status
    // clause this would republish every listing its seller had withdrawn.
    const db = await getTestDb();
    const draft = await makeListing({ status: "draft" });
    const removed = await makeListing({ status: "removed" });
    const sold = await makeListing({ status: "sold" });

    await releaseUnheldListings(db);

    expect(await statusOf(draft.id)).toBe("draft");
    expect(await statusOf(removed.id)).toBe("removed");
    expect(await statusOf(sold.id)).toBe("sold");
  });

  it("scopes to one listing when given one", async () => {
    const db = await getTestDb();
    const mine = await makeListing({ status: "reserved" });
    const theirs = await makeListing({ status: "reserved" });

    expect(await releaseUnheldListings(db, mine.id)).toBe(1);

    expect(await statusOf(mine.id)).toBe("active");
    expect(await statusOf(theirs.id)).toBe("reserved");
  });
});

describe("claimListing", () => {
  it("reserves an active listing and returns its price and seller", async () => {
    const db = await getTestDb();
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, price: "123.45" });

    const claimed = await claimListing(db, listing.id);

    expect(claimed).toEqual({ id: listing.id, price: "123.45", sellerId: seller.id });
    expect(await statusOf(listing.id)).toBe("reserved");
  });

  it("returns null for a listing that is already reserved", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });

    expect(await claimListing(db, listing.id)).toBeNull();
  });

  it("returns null for a sold, draft or removed listing", async () => {
    const db = await getTestDb();

    for (const status of ["sold", "draft", "removed"] as const) {
      const listing = await makeListing({ status });
      expect(await claimListing(db, listing.id), status).toBeNull();
      expect(await statusOf(listing.id)).toBe(status);
    }
  });

  it("returns null for a listing that does not exist", async () => {
    const db = await getTestDb();
    expect(await claimListing(db, 999_999)).toBeNull();
  });

  it("lets exactly one of two concurrent claims win", async () => {
    // The whole point of the conditional UPDATE. A lock would serialise these and let
    // both succeed in turn; the WHERE clause makes the second one match nothing.
    const db = await getTestDb();
    const listing = await makeListing();

    const [a, b] = await Promise.all([
      claimListing(db, listing.id),
      claimListing(db, listing.id),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("does not bump the listing's updated_at", async () => {
    // `updated_at` drives the embedding backfill's staleness query. A reservation says
    // nothing about the listing's text, and marking it stale would re-embed every
    // listing anybody ever clicked Buy on.
    const db = await getTestDb();
    const listing = await makeListing();

    await claimListing(db, listing.id);

    const [row] = await db
      .select({ updatedAt: listings.updatedAt })
      .from(listings)
      .where(eq(listings.id, listing.id));

    expect(row.updatedAt.getTime()).toBe(listing.updatedAt.getTime());
  });
});

describe("applyListingSideEffect", () => {
  it("sells a reserved listing", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });

    await applyListingSideEffect(db, listing.id, "sold");

    expect(await statusOf(listing.id)).toBe("sold");
  });

  it("refuses to sell a listing that was never reserved", async () => {
    // Reaching `sold` without passing through `reserved` would mean an order confirmed a
    // listing nobody had claimed.
    const db = await getTestDb();
    const listing = await makeListing({ status: "active" });

    await applyListingSideEffect(db, listing.id, "sold");

    expect(await statusOf(listing.id)).toBe("active");
  });

  it("returns a reserved listing to browse", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });

    await applyListingSideEffect(db, listing.id, "active");

    expect(await statusOf(listing.id)).toBe("active");
  });

  it("returns a sold listing to browse, for a cancellation after confirmation", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "sold" });

    await applyListingSideEffect(db, listing.id, "active");

    expect(await statusOf(listing.id)).toBe("active");
  });

  it("never republishes a draft or removed listing", async () => {
    const db = await getTestDb();
    const draft = await makeListing({ status: "draft" });
    const removed = await makeListing({ status: "removed" });

    await applyListingSideEffect(db, draft.id, "active");
    await applyListingSideEffect(db, removed.id, "active");

    expect(await statusOf(draft.id)).toBe("draft");
    expect(await statusOf(removed.id)).toBe("removed");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- src/db/orders.integration.test.ts`
Expected: FAIL — `Failed to resolve import "@/db/orders"`.

- [ ] **Step 3: Write the module**

Create `src/db/orders.ts`:

```ts
// ─── Reservation and expiry ───────────────────────────────────────────────────
// Part 3 of the 2026-08-30 redesign (spec §5.2, §5.4).
//
// Four statements. The reserve path runs all of them against one listing inside its own
// transaction; the scheduled sweep runs the first two globally. Sharing the file is what
// stops the lazy path and the sweep from drifting into two different definitions of
// "expired" — D4 says correctness lives in the lazy path, and the sweep exists only so
// listings return to browse promptly.
//
// Written as raw `sql` rather than through the query builder, for two reasons. The
// statements are the spec's, verbatim, and a reviewer should be able to read one against
// the other. And `listings.updatedAt` carries `$onUpdate`: a builder update would stamp
// it on every reservation, and `updated_at` is what the embedding backfill's staleness
// query compares against — every Buy click would queue a needless re-embed.

import { sql } from "drizzle-orm";

import { RESERVATION_HOURS } from "@/lib/order-lifecycle";

import { type Database } from "./index";

/**
 * Either the pool-backed client or a transaction handle.
 *
 * Every function here has to be callable inside the reserve transaction: expiring a
 * stale order and claiming the listing it was holding are one atomic act, and committing
 * them separately is the double-sell in slow motion.
 */
export type OrderExecutor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ClaimedListing = { id: number; price: string; sellerId: number };

/**
 * `now() + 48 hours`, computed by Postgres.
 *
 * The cast is deliberate and local. Drizzle types `expiresAt` as `Date` because the
 * column is a timestamp; the value we want is an expression, not a value Node computed.
 * The container clock and the host clock disagree on this project's dev machines, and a
 * deadline set from the wrong one expires orders early or never.
 */
export function reservationDeadline(): Date {
  return sql`now() + make_interval(hours => ${RESERVATION_HOURS})` as unknown as Date;
}

/**
 * Marks every pending order past its deadline `expired`.
 *
 * @param listingId scope to one listing; omit to sweep globally.
 * @returns how many orders were expired.
 */
export async function expireStalePendingOrders(
  x: OrderExecutor,
  listingId?: number,
): Promise<number> {
  const scope = listingId === undefined ? sql`` : sql` AND "listing_id" = ${listingId}`;

  const result = await x.execute(sql`
    UPDATE "orders" SET "status" = 'expired', "updated_at" = now()
     WHERE "status" = 'pending' AND "expires_at" < now()${scope}
     RETURNING "id"
  `);

  return result.rows.length;
}

/**
 * Returns reserved listings to browse once nothing pending holds them.
 *
 * The `status = 'reserved'` clause is load-bearing: without it this republishes every
 * listing whose seller withdrew it, since a `removed` listing also has no pending order.
 *
 * @param listingId scope to one listing; omit to sweep globally.
 * @returns how many listings were released.
 */
export async function releaseUnheldListings(
  x: OrderExecutor,
  listingId?: number,
): Promise<number> {
  const scope = listingId === undefined ? sql`` : sql` AND "id" = ${listingId}`;

  const result = await x.execute(sql`
    UPDATE "listings" SET "status" = 'active'
     WHERE "status" = 'reserved'${scope}
       AND NOT EXISTS (
         SELECT 1 FROM "orders"
          WHERE "orders"."listing_id" = "listings"."id"
            AND "orders"."status" = 'pending'
       )
     RETURNING "id"
  `);

  return result.rows.length;
}

/**
 * Claims a listing for a buyer, or returns null if someone else already has it.
 *
 * This is the whole of D2. `WHERE status = 'active'` is what makes the race
 * unrepresentable: the second caller's UPDATE matches no rows, rather than waiting for a
 * lock and then succeeding against a listing that is no longer available.
 *
 * The price and seller come back from `RETURNING` so the order is priced from the
 * database's row at the instant of the claim, never from anything the client sent.
 */
export async function claimListing(
  x: OrderExecutor,
  listingId: number,
): Promise<ClaimedListing | null> {
  const result = await x.execute(sql`
    UPDATE "listings" SET "status" = 'reserved'
     WHERE "id" = ${listingId} AND "status" = 'active'
     RETURNING "id", "price", "seller_id"
  `);

  const row = result.rows[0] as
    | { id: number; price: string; seller_id: number }
    | undefined;

  return row ? { id: row.id, price: row.price, sellerId: row.seller_id } : null;
}

/**
 * Applies an order transition's effect on its listing (spec §5.3).
 *
 * Both statements are conditional on the status they expect to find, so a listing its
 * seller has since withdrawn is not dragged back into browse by an order being settled.
 */
export async function applyListingSideEffect(
  x: OrderExecutor,
  listingId: number,
  next: "active" | "sold",
): Promise<void> {
  if (next === "sold") {
    await x.execute(sql`
      UPDATE "listings" SET "status" = 'sold'
       WHERE "id" = ${listingId} AND "status" = 'reserved'
    `);
    return;
  }

  await x.execute(sql`
    UPDATE "listings" SET "status" = 'active'
     WHERE "id" = ${listingId} AND "status" IN ('reserved', 'sold')
  `);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- src/db/orders.integration.test.ts`
Expected: PASS, every case.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Prove the two guards can fail**

Drop the status clause from `releaseUnheldListings` — change `WHERE "status" = 'reserved'${scope}` to `WHERE true${scope}`.

Run: `npm run test:integration -- src/db/orders.integration.test.ts -t "never resurrects"`
Expected: FAIL — the removed listing comes back as `active`.

Restore it. Then drop the status clause from `claimListing`: change `AND "status" = 'active'` to `AND true`.

Run: `npm run test:integration -- src/db/orders.integration.test.ts -t "lets exactly one"`
Expected: FAIL — both claims return a row.

Restore it and re-run the whole file; expected PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/orders.ts src/db/orders.integration.test.ts
git commit -m "feat(orders): the reservation and expiry statements"
```

---

### Task 4: Placing an order reserves the listing

**Files:**
- Modify: `src/app/api/orders/route.ts` (whole file)
- Modify: `src/app/(frontend)/listings/[id]/page.tsx:78-80`
- Test: `src/app/api/orders/route.integration.test.ts` (create)

**Interfaces:**
- Consumes: `claimListing`, `expireStalePendingOrders`, `releaseUnheldListings`, `reservationDeadline` from `@/db/orders` (Task 3); `CreateOrderSchema` from `@/lib/validation` (Task 2).
- Produces: `POST /api/orders` takes `{ listingId }` and answers **201** with the whole order row, **403** for self-purchase, **404** for a listing that is not purchasable, **409** when someone else got there first. `GET /api/orders` returns the caller's own purchases, or every order for an admin.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/orders/route.integration.test.ts`:

```ts
/**
 * Part 3 spec §5.2 — reservation, through the route.
 *
 * The concurrency case is the reason this part exists: two buyers, one second-hand
 * object, and exactly one of them may end up owning it.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { listings, orders } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb();
});

async function place(
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("./route");
  const response = await POST(
    new NextRequest("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function list(headers: Record<string, string>) {
  const { GET } = await import("./route");
  const response = await GET(new NextRequest("http://localhost/api/orders", { headers }));
  return { status: response.status, body: await response.json() };
}

async function statusOf(listingId: number): Promise<string> {
  const db = await getTestDb();
  const [row] = await db
    .select({ status: listings.status })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  return row.status;
}

describe("POST /api/orders — the happy path", () => {
  it("creates the order and reserves the listing", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ price: "250.00" });

    const { status, body } = await place(authHeaderFor(buyer), { listingId: listing.id });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      buyerId: buyer.id,
      listingId: listing.id,
      sellerId: listing.sellerId,
      price: "250.00",
      status: "pending",
    });
    expect(await statusOf(listing.id)).toBe("reserved");
  });

  it("prices the order from the listing, never from the body", async () => {
    // The old route trusted a client-supplied quantity and multiplied by it. Anything the
    // client sends beyond `listingId` is ignored.
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ price: "250.00" });

    const { body } = await place(authHeaderFor(buyer), {
      listingId: listing.id,
      price: "0.01",
      quantity: 99,
    });

    expect(body.price).toBe("250.00");
  });

  it("gives the order a deadline 48 hours out", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing();

    const { body } = await place(authHeaderFor(buyer), { listingId: listing.id });

    const expiresAt = new Date(body.expiresAt as string).getTime();
    const createdAt = new Date(body.createdAt as string).getTime();
    expect(expiresAt - createdAt).toBeCloseTo(48 * HOUR, -3);
  });

  it("lets a seller buy from another seller (D5)", async () => {
    const buyerSeller = await makeUser({ role: "seller" });
    const listing = await makeListing();

    const { status } = await place(authHeaderFor(buyerSeller), { listingId: listing.id });

    expect(status).toBe(201);
  });
});

describe("POST /api/orders — the refusals", () => {
  it("answers 401 to an anonymous caller", async () => {
    const listing = await makeListing();
    const { status } = await place({}, { listingId: listing.id });
    expect(status).toBe(401);
  });

  it("answers 403 to a seller buying their own listing", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });

    const { status } = await place(authHeaderFor(seller), { listingId: listing.id });

    expect(status).toBe(403);
    // The refusal must not leave the listing held.
    expect(await statusOf(listing.id)).toBe("active");
  });

  it("answers 404 for a listing that does not exist", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const { status } = await place(authHeaderFor(buyer), { listingId: 999_999 });
    expect(status).toBe(404);
  });

  it("answers 404 for a draft or removed listing", async () => {
    const buyer = await makeUser({ role: "buyer" });

    for (const listingStatus of ["draft", "removed"] as const) {
      const listing = await makeListing({ status: listingStatus });
      const { status } = await place(authHeaderFor(buyer), { listingId: listing.id });
      expect(status, listingStatus).toBe(404);
    }
  });

  it("answers 409 for a listing someone else has already reserved", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() + HOUR),
    });

    const { status } = await place(authHeaderFor(buyer), { listingId: listing.id });

    expect(status).toBe(409);
  });

  it("answers 409 for a sold listing", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ status: "sold" });

    const { status } = await place(authHeaderFor(buyer), { listingId: listing.id });

    expect(status).toBe(409);
  });

  it("answers 400 for the old cart-shaped body", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing();

    const { status } = await place(authHeaderFor(buyer), {
      items: [{ listingId: listing.id }],
    });

    expect(status).toBe(400);
  });
});

describe("POST /api/orders — the race", () => {
  it("lets exactly one of two simultaneous buyers through", async () => {
    // The case the old route could not survive: both buyers passed `status = 'active'`,
    // the lock serialised the writes, and the marketplace sold one bicycle twice.
    const a = await makeUser({ role: "buyer" });
    const b = await makeUser({ role: "buyer" });
    const listing = await makeListing();

    const [first, second] = await Promise.all([
      place(authHeaderFor(a), { listingId: listing.id }),
      place(authHeaderFor(b), { listingId: listing.id }),
    ]);

    const codes = [first.status, second.status].sort();
    expect(codes).toEqual([201, 409]);

    const db = await getTestDb();
    const rows = await db.select().from(orders).where(eq(orders.listingId, listing.id));
    expect(rows).toHaveLength(1);
  });

  it("leaves the listing reserved exactly once", async () => {
    const a = await makeUser({ role: "buyer" });
    const b = await makeUser({ role: "buyer" });
    const c = await makeUser({ role: "buyer" });
    const listing = await makeListing();

    const results = await Promise.all([
      place(authHeaderFor(a), { listingId: listing.id }),
      place(authHeaderFor(b), { listingId: listing.id }),
      place(authHeaderFor(c), { listingId: listing.id }),
    ]);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await statusOf(listing.id)).toBe("reserved");
  });
});

describe("POST /api/orders — lazy expiry (D4)", () => {
  it("takes over a listing whose reservation has lapsed", async () => {
    const stale = await makeUser({ role: "buyer" });
    const fresh = await makeUser({ role: "buyer" });
    const listing = await makeListing({ status: "reserved" });
    const abandoned = await makeOrder({
      buyerId: stale.id,
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() - HOUR),
    });

    const { status } = await place(authHeaderFor(fresh), { listingId: listing.id });

    expect(status).toBe(201);

    // Correctness does not wait for the sweep: the reserve path expired it.
    const db = await getTestDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, abandoned.id));
    expect(row.status).toBe("expired");
  });

  it("does not take over a reservation that is still live", async () => {
    const holder = await makeUser({ role: "buyer" });
    const other = await makeUser({ role: "buyer" });
    const listing = await makeListing({ status: "reserved" });
    const live = await makeOrder({
      buyerId: holder.id,
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() + HOUR),
    });

    const { status } = await place(authHeaderFor(other), { listingId: listing.id });

    expect(status).toBe(409);

    const db = await getTestDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, live.id));
    expect(row.status).toBe("pending");
  });
});

describe("GET /api/orders", () => {
  it("returns only the caller's own purchases", async () => {
    const mine = await makeUser({ role: "buyer" });
    const theirs = await makeUser({ role: "buyer" });
    const a = await makeOrder({ buyerId: mine.id });
    await makeOrder({ buyerId: theirs.id });

    const { status, body } = await list(authHeaderFor(mine));

    expect(status).toBe(200);
    expect((body as { id: number }[]).map((o) => o.id)).toEqual([a.id]);
  });

  it("returns a seller's own purchases, not their sales", async () => {
    // A seller's sales are `/api/orders/seller`. This endpoint is what the caller bought,
    // whatever role they hold.
    const seller = await makeUser({ role: "seller" });
    const bought = await makeOrder({ buyerId: seller.id });
    await makeOrder({ sellerId: seller.id });

    const { body } = await list(authHeaderFor(seller));

    expect((body as { id: number }[]).map((o) => o.id)).toEqual([bought.id]);
  });

  it("returns every order to an admin", async () => {
    const admin = await makeUser({ role: "admin" });
    await makeOrder();
    await makeOrder();

    const { body } = await list(authHeaderFor(admin));

    expect(body).toHaveLength(2);
  });

  it("answers 401 to an anonymous caller", async () => {
    const { status } = await list({});
    expect(status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- src/app/api/orders/route.integration.test.ts`
Expected: FAIL — the route still expects `{ items: [...] }`, so the happy path answers 400.

- [ ] **Step 3: Rewrite the route**

Replace `src/app/api/orders/route.ts` entirely. Keep the two `@swagger` blocks in place, updated as shown; the generator reads them from this file.

```ts
import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  claimListing,
  expireStalePendingOrders,
  releaseUnheldListings,
  reservationDeadline,
} from "@/db/orders";
import { listings, orders } from "@/db/schema";
import { authenticate, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";
import { parseRequest, CreateOrderSchema } from "@/lib/validation";

/**
 * Raised inside the reserve transaction so the rollback happens naturally; the handler
 * translates it into a 409. Not exported: route files may only export HTTP handlers.
 */
class ListingUnavailableError extends Error {
  constructor() {
    super("Listing is not available");
    this.name = "ListingUnavailableError";
  }
}

// ─── GET /api/orders ──────────────────────────────────────────────────────────
// Any authenticated caller. Own purchases; admins see every order.
/**
 * @swagger
 * /api/orders:
 *   get:
 *     tags: [Orders]
 *     summary: List the caller's purchases
 *     description: |
 *       What the caller bought, whatever role they hold — a seller's own purchases appear
 *       here, their sales appear in `/api/orders/seller`. Admins see every order.
 *       Sorted newest first.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of orders
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Order'
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function GET(request: NextRequest) {
  try {
    // No role gate: sellers buy too (D5), and what this returns is scoped by buyer id
    // rather than by role.
    const payload = authenticate(request);

    const rows = await db
      .select()
      .from(orders)
      .where(payload.role === "admin" ? undefined : eq(orders.buyerId, payload.sub))
      .orderBy(desc(orders.createdAt));

    return jsonOk(rows);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/orders]", err);
    return jsonError("Internal server error");
  }
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────
// Any authenticated caller except the listing's own seller.
// Body: { listingId: number }
/**
 * @swagger
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Reserve a listing
 *     description: |
 *       Claims the listing for the caller and creates a pending order priced from the
 *       listing row. The listing becomes `reserved` and the seller has 48 hours to
 *       confirm or decline before the reservation lapses.
 *
 *       Anyone signed in may buy, including sellers — but not their own listing.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [listingId]
 *             properties:
 *               listingId:
 *                 type: integer
 *                 example: 5
 *     responses:
 *       201:
 *         description: Order created and listing reserved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Order'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: The caller is the listing's seller
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: No such listing, or it was never published
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Another buyer reserved it first
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function POST(request: NextRequest) {
  try {
    const payload = authenticate(request);

    const parsed = await parseRequest(request, CreateOrderSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { listingId } = parsed.data;

    // Read first, only to tell the two refusals apart: a listing that was never
    // purchasable is a 404, one that someone else is holding is a 409. The read is not a
    // check — the claim below is authoritative, and `sellerId` cannot change under us.
    const [listing] = await db
      .select({ sellerId: listings.sellerId, status: listings.status })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);

    if (!listing || listing.status === "draft" || listing.status === "removed") {
      return jsonError("Listing not found or not available", 404);
    }

    // D5: everyone is both buyer and seller in a peer-to-peer marketplace, so the guard
    // is on the pair of ids rather than on the caller's role.
    if (listing.sellerId === payload.sub) {
      return jsonError("You cannot buy your own listing", 403);
    }

    const order = await db.transaction(async (tx) => {
      // D4: correctness does not wait for the sweep. Anything stale holding this listing
      // is expired and released here, in the same transaction as the claim.
      await expireStalePendingOrders(tx, listingId);
      await releaseUnheldListings(tx, listingId);

      const claimed = await claimListing(tx, listingId);
      if (!claimed) throw new ListingUnavailableError();

      const [created] = await tx
        .insert(orders)
        .values({
          buyerId: payload.sub,
          sellerId: claimed.sellerId,
          listingId: claimed.id,
          price: claimed.price,
          expiresAt: reservationDeadline(),
        })
        .returning();

      return created;
    });

    return jsonOk(order, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    if (err instanceof ListingUnavailableError) {
      return jsonError("This listing has just been reserved by another buyer", 409);
    }
    console.error("[POST /api/orders]", err);
    return jsonError("Internal server error");
  }
}
```

- [ ] **Step 4: Point the Buy button at the new body**

In `src/app/(frontend)/listings/[id]/page.tsx`, replace the order call:

```tsx
      const order = await api.post<CreatedOrder>("/api/orders", { listingId });
```

and replace the "Only buyers can place orders" guard above it, which contradicts D5:

```tsx
    if (user?.id === listing.sellerId) {
      setActionError("You cannot buy your own listing");
      setIsBuyModalOpen(false);
      return;
    }
```

The `canReview` line stays as it is; reviews move in Part 4.

- [ ] **Step 5: Run the tests**

Run: `npm run test:integration -- src/app/api/orders/route.integration.test.ts`
Expected: PASS, every case.

Run: `npx tsc --noEmit`
Expected: clean. `AuthUser` from `src/context/AuthContext.tsx` carries `id`, `email`, `name`, `role` and `phoneNumber`, so `user.id` and `user.role` are both available.

- [ ] **Step 6: Prove the race test can fail**

In `src/db/orders.ts`, temporarily change `claimListing`'s condition from `AND "status" = 'active'` to `AND "status" IN ('active', 'reserved')` — the behaviour of a route that locks instead of claiming.

Run: `npm run test:integration -- src/app/api/orders/route.integration.test.ts -t "exactly one of two simultaneous"`
Expected: FAIL — two 201s and two order rows.

Restore the line and re-run the file; expected PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/orders/route.ts src/app/api/orders/route.integration.test.ts \
  "src/app/(frontend)/listings/[id]/page.tsx"
git commit -m "feat(orders): placing an order reserves the listing"
```

---

### Task 5: Transitions

The route the spec describes in one sentence: resolve the order, check the actor is a party to *this* order, check the transition is legal, apply it — with the listing side effect in the same transaction.

**Files:**
- Modify: `src/lib/authorization.ts`, `src/lib/authorization.test.ts`
- Modify: `src/app/api/orders/[id]/route.ts` (whole file)
- Modify: `src/app/api/rbac.integration.test.ts` (the two order describes)
- Modify: `src/types/api.ts` (the Orders section)
- Modify: `src/app/(frontend)/orders/[id]/page.tsx`, `src/app/(frontend)/orders/page.tsx`
- Create: `src/components/orders/OrderActions.tsx`
- Test: `src/app/api/orders/[id]/route.integration.test.ts` (create), `src/components/orders/OrderActions.component.test.tsx` (create)

**Interfaces:**
- Consumes: `canTransition`, `listingStatusAfter`, `OrderActor`, `OrderStatus` from `@/lib/order-lifecycle`; `applyListingSideEffect` from `@/db/orders`.
- Produces:
  - `orderActorFor(actor: TokenPayload, order: { buyerId: number; sellerId: number }): OrderActor | null` in `authorization.ts`
  - `canViewOrder(actor, order: { buyerId: number; sellerId: number }): boolean` — now needs `sellerId`
  - `canApproveOrder` is **deleted**
  - `GET /api/orders/[id]` returns `Order & { listingTitle: string; coverImageId: number | null }`
  - `type OrderDetail` in `types/api.ts` is that shape; `OrderItem` and `SellerOrderItem` are deleted
  - `<OrderActions status actor busy onTransition />`

- [ ] **Step 1: Write the failing authorization test**

In `src/lib/authorization.test.ts`, replace the `canViewOrder` and `canApproveOrder` describes with:

```ts
describe("Part 3 — orderActorFor", () => {
  const order = { buyerId: BUYER.sub, sellerId: SELLER.sub };

  it("calls the buyer a buyer", () => {
    expect(orderActorFor(BUYER, order)).toBe("buyer");
  });

  it("calls the seller a seller", () => {
    expect(orderActorFor(SELLER, order)).toBe("seller");
  });

  it("calls an admin an admin, whichever side they are on", () => {
    expect(orderActorFor(ADMIN, order)).toBe("admin");
    expect(orderActorFor(ADMIN, { buyerId: ADMIN.sub, sellerId: SELLER.sub })).toBe("admin");
  });

  it("makes a stranger no party at all", () => {
    expect(orderActorFor(OTHER_SELLER, order)).toBeNull();
    expect(orderActorFor(actor(99, "buyer"), order)).toBeNull();
  });

  it("reads ids, not roles", () => {
    // A user whose role is `buyer` can still be the seller on an order they placed a
    // listing for — D5 makes everyone both. Gating on the role here would lock them out
    // of their own sale.
    const swapped = { buyerId: SELLER.sub, sellerId: BUYER.sub };
    expect(orderActorFor(BUYER, swapped)).toBe("seller");
    expect(orderActorFor(SELLER, swapped)).toBe("buyer");
  });

  it("prefers buyer when the same user is somehow both", () => {
    // The route refuses self-purchase, so this should not exist. If a row ever does, the
    // answer must be deterministic rather than whichever branch ran first.
    expect(orderActorFor(BUYER, { buyerId: BUYER.sub, sellerId: BUYER.sub })).toBe("buyer");
  });
});

describe("Part 3 — canViewOrder", () => {
  const order = { buyerId: BUYER.sub, sellerId: SELLER.sub };

  it("allows the buyer who placed it", () => {
    expect(canViewOrder(BUYER, order)).toBe(true);
  });

  it("allows the seller who is selling it", () => {
    // Changed by Part 3. The old rule refused sellers because an order was a basket that
    // could expose the buyer's other purchases. One order is now one listing this seller
    // already sells, so there is nothing left to hide from them.
    expect(canViewOrder(SELLER, order)).toBe(true);
  });

  it("allows an admin", () => {
    expect(canViewOrder(ADMIN, order)).toBe(true);
  });

  it("refuses everyone else", () => {
    expect(canViewOrder(OTHER_SELLER, order)).toBe(false);
    expect(canViewOrder(actor(99, "buyer"), order)).toBe(false);
  });
});
```

Update that file's import list: add `orderActorFor`, drop `canApproveOrder`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:unit -- src/lib/authorization.test.ts`
Expected: FAIL — `orderActorFor is not a function`.

- [ ] **Step 3: Write the predicates**

In `src/lib/authorization.ts`, add the import:

```ts
import type { OrderActor } from "./order-lifecycle";
```

and replace `canViewOrder` and `canApproveOrder` with:

```ts
/**
 * The caller's relationship to this order, or null if they have none.
 *
 * Ids, not roles. `canMutateListing` deliberately checks the role as well, because ids
 * are per-table there and a buyer whose user id happens to equal some listing's
 * `sellerId` is not that seller. Here both fields are user ids from the same table, and
 * D5 makes every user potentially both — so a role check would lock a seller out of the
 * purchase they made, or a buyer out of the sale they are making.
 *
 * Buyer wins if the same user is somehow both: the route refuses self-purchase, but a
 * predicate must still be deterministic rather than order-of-evaluation dependent.
 */
export function orderActorFor(
  actor: TokenPayload,
  order: { buyerId: number; sellerId: number },
): OrderActor | null {
  if (isAdmin(actor)) return "admin";
  if (actor.sub === order.buyerId) return "buyer";
  if (actor.sub === order.sellerId) return "seller";
  return null;
}

/**
 * Whether the caller may read an order.
 *
 * Both parties and admins. Everyone else gets a 404 rather than a 403 — order ids are
 * sequential, so confirming existence is an enumeration oracle.
 */
export function canViewOrder(
  actor: TokenPayload,
  order: { buyerId: number; sellerId: number },
): boolean {
  return orderActorFor(actor, order) !== null;
}
```

`canApproveOrder` is deleted outright. Its `ownsListingInOrder` argument was the route reconciling `order_items` against the seller's listings — the reconciliation the SEC-10 ownership bug lived in, and the one D1 removes by putting `seller_id` on the order.

- [ ] **Step 4: Write the failing route test**

Create `src/app/api/orders/[id]/route.integration.test.ts`:

```ts
/**
 * Part 3 spec §5.3 — transitions, and the listing status each one implies.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { listings, orders } from "@/db/schema";
import type { OrderStatus } from "@/lib/order-lifecycle";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

type Party = { id: number };

async function transition(
  orderId: number,
  headers: Record<string, string>,
  status: string,
) {
  const { PUT } = await import("./route");
  const response = await PUT(
    new NextRequest(`http://localhost/api/orders/${orderId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: String(orderId) }) },
  );
  return { status: response.status, body: await response.json() };
}

async function read(orderId: number, headers: Record<string, string>) {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/orders/${orderId}`, { headers }),
    { params: Promise.resolve({ id: String(orderId) }) },
  );
  return { status: response.status, body: await response.json() };
}

/** A pending order on a reserved listing — the state `POST /api/orders` leaves behind. */
async function pendingOrder(seller: Party, buyer: Party) {
  const listing = await makeListing({ sellerId: seller.id, status: "reserved" });
  const order = await makeOrder({
    buyerId: buyer.id,
    sellerId: seller.id,
    listingId: listing.id,
    status: "pending",
  });
  return { listing, order };
}

async function listingStatus(id: number): Promise<string> {
  const db = await getTestDb();
  const [row] = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, id));
  return row.status;
}

async function orderStatus(id: number): Promise<OrderStatus> {
  const db = await getTestDb();
  const [row] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id));
  return row.status;
}

describe("PUT /api/orders/[id] — who may drive what", () => {
  it("lets the seller confirm, and sells the listing", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(seller), "confirmed");

    expect(status).toBe(200);
    expect(await orderStatus(order.id)).toBe("confirmed");
    expect(await listingStatus(listing.id)).toBe("sold");
  });

  it("lets the seller decline, and returns the listing to browse", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(seller), "declined");

    expect(status).toBe(200);
    expect(await listingStatus(listing.id)).toBe("active");
  });

  it("lets the buyer cancel a pending order, and returns the listing to browse", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(buyer), "cancelled");

    expect(status).toBe(200);
    expect(await listingStatus(listing.id)).toBe("active");
  });

  it("refuses a buyer confirming their own order", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(buyer), "confirmed");

    expect(status).toBe(400);
    expect(await orderStatus(order.id)).toBe("pending");
    expect(await listingStatus(listing.id)).toBe("reserved");
  });

  it("refuses a seller cancelling instead of declining", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(seller), "cancelled");

    expect(status).toBe(400);
    expect(await orderStatus(order.id)).toBe("pending");
  });

  it("lets an admin drive any legal transition", async () => {
    const admin = await makeUser({ role: "admin" });
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(admin), "expired");

    expect(status).toBe(200);
    expect(await orderStatus(order.id)).toBe("expired");
  });

  it("refuses buyer and seller marking an order expired", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { order } = await pendingOrder(seller, buyer);

    expect((await transition(order.id, authHeaderFor(buyer), "expired")).status).toBe(400);
    expect((await transition(order.id, authHeaderFor(seller), "expired")).status).toBe(400);
  });
});

describe("PUT /api/orders/[id] — the rest of the graph", () => {
  async function confirmed(seller: Party, buyer: Party) {
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      listingId: listing.id,
      status: "confirmed",
    });
    return { listing, order };
  }

  it("lets the seller ship, leaving the listing sold", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const { listing, order } = await confirmed(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(seller), "shipped");

    expect(status).toBe(200);
    expect(await listingStatus(listing.id)).toBe("sold");
  });

  it("lets the buyer complete a shipped order, leaving the listing sold", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ sellerId: seller.id, status: "sold" });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      listingId: listing.id,
      status: "shipped",
    });

    const { status } = await transition(order.id, authHeaderFor(buyer), "completed");

    expect(status).toBe(200);
    expect(await listingStatus(listing.id)).toBe("sold");
  });

  it("lets either party cancel after confirmation, and republishes the listing", async () => {
    for (const canceller of ["buyer", "seller"] as const) {
      await resetDb();
      const seller = await makeUser({ role: "seller" });
      const buyer = await makeUser({ role: "buyer" });
      const { listing, order } = await confirmed(seller, buyer);
      const who = canceller === "buyer" ? buyer : seller;

      const { status } = await transition(order.id, authHeaderFor(who), "cancelled");

      expect(status, canceller).toBe(200);
      expect(await listingStatus(listing.id)).toBe("active");
    }
  });

  it("refuses every transition out of a terminal state", async () => {
    const admin = await makeUser({ role: "admin" });
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });

    for (const from of ["completed", "cancelled", "declined", "expired"] as const) {
      const order = await makeOrder({ buyerId: buyer.id, sellerId: seller.id, status: from });
      const { status } = await transition(order.id, authHeaderFor(admin), "confirmed");
      expect(status, from).toBe(400);
    }
  });
});

describe("PUT /api/orders/[id] — hiding existence", () => {
  it("answers 404, not 403, to a stranger", async () => {
    // A 403 would confirm the order exists, and order ids are sequential.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const stranger = await makeUser({ role: "seller" });
    const { order } = await pendingOrder(seller, buyer);

    const { status } = await transition(order.id, authHeaderFor(stranger), "confirmed");

    expect(status).toBe(404);
    expect(await orderStatus(order.id)).toBe("pending");
  });

  it("gives a stranger the same answer for a real order and a missing one", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const stranger = await makeUser({ role: "seller" });
    const { order } = await pendingOrder(seller, buyer);

    const real = await transition(order.id, authHeaderFor(stranger), "confirmed");
    const missing = await transition(999_999, authHeaderFor(stranger), "confirmed");

    expect(real).toEqual(missing);
  });

  it("decides authorisation before it looks at the order's state", async () => {
    // "Only pending orders can be confirmed" would tell a stranger what state someone
    // else's purchase is in.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const stranger = await makeUser({ role: "seller" });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      status: "completed",
    });

    const { status } = await transition(order.id, authHeaderFor(stranger), "confirmed");

    expect(status).toBe(404);
  });
});

describe("GET /api/orders/[id]", () => {
  it("returns the order with its listing's title", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const listing = await makeListing({ title: "Road bike" });
    const order = await makeOrder({ buyerId: buyer.id, listingId: listing.id });

    const { status, body } = await read(order.id, authHeaderFor(buyer));

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: order.id, listingId: listing.id, listingTitle: "Road bike" });
  });

  it("lets the seller read their own sale", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id });
    const order = await makeOrder({ sellerId: seller.id, listingId: listing.id });

    const { status } = await read(order.id, authHeaderFor(seller));

    expect(status).toBe(200);
  });

  it("answers 404 to a stranger", async () => {
    const stranger = await makeUser({ role: "buyer" });
    const order = await makeOrder();

    const { status } = await read(order.id, authHeaderFor(stranger));

    expect(status).toBe(404);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm run test:integration -- "src/app/api/orders/[id]/route.integration.test.ts"`
Expected: FAIL — the route still speaks `approved`/`rejected` and reads `order_items`.

- [ ] **Step 6: Rewrite the route**

Replace `src/app/api/orders/[id]/route.ts`. `GET` and `DELETE` keep their `@swagger` blocks with the item arrays removed from the response schemas; `PUT`'s block is rewritten as shown. The handler bodies:

```ts
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { coverImageIdsFor } from "@/db/listing-images";
import { applyListingSideEffect } from "@/db/orders";
import { listings, orders } from "@/db/schema";
import { HIDE_EXISTENCE_MESSAGE, canViewOrder, orderActorFor } from "@/lib/authorization";
import { authenticate, AuthError } from "@/lib/middleware";
import { canTransition, listingStatusAfter } from "@/lib/order-lifecycle";
import { parseResourceId } from "@/lib/params";
import { jsonOk, jsonError } from "@/lib/response";
import { parseRequest, UpdateOrderStatusSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };
```

`GET`:

```ts
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [row] = await db
      .select({
        order: orders,
        listingTitle: listings.title,
      })
      .from(orders)
      .leftJoin(listings, eq(listings.id, orders.listingId))
      .where(eq(orders.id, id))
      .limit(1);

    // 404 for "not yours", identical to "does not exist" (C2C-SEC-10 AC3). A 403 here
    // would confirm the order is real, and order ids are sequential.
    if (!row || !canViewOrder(payload, row.order)) {
      return jsonError(HIDE_EXISTENCE_MESSAGE, 404);
    }

    const covers = await coverImageIdsFor([row.order.listingId]);

    return jsonOk({
      ...row.order,
      // The FK is RESTRICT, so the join cannot miss. The fallback is for a database that
      // has been edited by hand rather than for a case the code can reach.
      listingTitle: row.listingTitle ?? `Listing #${row.order.listingId}`,
      coverImageId: covers.get(row.order.listingId) ?? null,
    });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/orders/[id]]", err);
    return jsonError("Internal server error");
  }
}
```

`PUT`:

```ts
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    // No role gate. Whether this caller may act is decided by their relationship to this
    // order, which `authorize()` cannot see.
    const payload = authenticate(request);

    const id = parseResourceId((await params).id);
    if (!id) return jsonError("Invalid order id", 400);

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);

    // Authorisation before state, and 404 rather than 403: "Only pending orders can be
    // confirmed" would tell a stranger what state someone else's purchase is in, and a
    // 403 would tell them it exists at all.
    const actor = order ? orderActorFor(payload, order) : null;
    if (!order || actor === null) return jsonError(HIDE_EXISTENCE_MESSAGE, 404);

    const parsed = await parseRequest(request, UpdateOrderStatusSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { status } = parsed.data;

    if (!canTransition(order.status, status, actor)) {
      return jsonError(`Cannot move an order from ${order.status} to ${status}`, 400);
    }

    const nextListingStatus = listingStatusAfter(status);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({ status })
        .where(eq(orders.id, id))
        .returning();

      // Same transaction as the status change, per §5.3: an order that confirmed while
      // its listing stayed reserved is the inconsistency this part exists to prevent.
      if (nextListingStatus !== null) {
        await applyListingSideEffect(tx, order.listingId, nextListingStatus);
      }

      return row;
    });

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PUT /api/orders/[id]]", err);
    return jsonError("Internal server error");
  }
}
```

`DELETE` keeps its body unchanged apart from one addition after the delete, since a deleted pending order would otherwise leave its listing held until the next sweep:

```ts
    await db.transaction(async (tx) => {
      await tx.delete(orders).where(eq(orders.id, id));
      await releaseUnheldListings(tx, order.listingId);
    });
```

Add `releaseUnheldListings` to the `@/db/orders` import.

The `PUT` swagger block's status enum becomes `[pending, confirmed, shipped, completed, cancelled, declined, expired]` and its description:

```
 *     description: |
 *       Moves an order through the lifecycle. Which transitions are available depends on
 *       the caller's relationship to this order, not on their role:
 *       - **Buyer**: cancel (from pending, confirmed or shipped); mark received (from shipped).
 *       - **Seller**: confirm or decline (from pending); mark shipped (from confirmed); cancel (from confirmed or shipped).
 *       - **Admin**: any legal transition.
 *
 *       Confirming marks the listing sold. Declining, cancelling or expiring returns it
 *       to browse. Anyone who is not a party to the order receives 404, not 403.
```

- [ ] **Step 7: Update the RBAC integration tests**

In `src/app/api/rbac.integration.test.ts`, replace the whole `C2C-SEC-10 AC4/AC5 — PUT /api/orders/[id]` describe with:

```ts
describe("C2C-SEC-10 AC4/AC5 — PUT /api/orders/[id]", () => {
  /** A pending order between these two, on a listing the seller owns. */
  async function orderFor(seller: { id: number }, buyer: { id: number }) {
    const category = await makeCategory();
    const listing = await makeListing({
      sellerId: seller.id,
      categoryId: category.id,
      status: "reserved",
    });
    return makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      listingId: listing.id,
      status: "pending",
    });
  }

  it("AC4: hides the order from a seller who has no stake in it", async () => {
    // Part 3 changed this from 403 to 404. With `seller_id` on the order a non-party is
    // indistinguishable from a stranger, and a 403 on a sequential id enumerates orders.
    const owner = await makeUser({ role: "seller" });
    const stranger = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const order = await orderFor(owner, buyer);

    const response = await call("./orders/[id]/route", "PUT", `/api/orders/${order.id}`, {
      headers: authHeaderFor(stranger),
      body: { status: "confirmed" },
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(404);

    const db = await getTestDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("pending");
  });

  it("allows the seller the order names", async () => {
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const order = await orderFor(seller, buyer);

    const response = await call("./orders/[id]/route", "PUT", `/api/orders/${order.id}`, {
      headers: authHeaderFor(seller),
      body: { status: "confirmed" },
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(200);
  });

  it("checks ownership before order state, so a stranger cannot read the status", async () => {
    const owner = await makeUser({ role: "seller" });
    const stranger = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const category = await makeCategory();
    const listing = await makeListing({ sellerId: owner.id, categoryId: category.id });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: owner.id,
      listingId: listing.id,
      status: "completed",
    });

    const response = await call("./orders/[id]/route", "PUT", `/api/orders/${order.id}`, {
      headers: authHeaderFor(stranger),
      body: { status: "confirmed" },
      params: { id: String(order.id) },
    });

    // Not 400 "only pending orders can be confirmed", which is a fact about someone
    // else's purchase.
    expect(response.status).toBe(404);
  });

  it("AC5: refuses a buyer confirming their own order, without hiding it from them", async () => {
    // The buyer IS a party, so this is 400 rather than 404: they may see their order,
    // they may not take the seller's decision for them.
    const seller = await makeUser({ role: "seller" });
    const buyer = await makeUser({ role: "buyer" });
    const order = await orderFor(seller, buyer);

    const response = await call("./orders/[id]/route", "PUT", `/api/orders/${order.id}`, {
      headers: authHeaderFor(buyer),
      body: { status: "confirmed" },
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(400);

    const db = await getTestDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("pending");
  });
});
```

The `GET /api/orders/[id] hides existence` describe needs no other change — its "stranger" is a fresh buyer who is a party to nothing, and `makeOrder` gives every order a seller who is not them. Add one case to it, covering the rule that changed:

```ts
  it("lets the selling seller read it", async () => {
    const seller = await makeUser({ role: "seller" });
    const order = await makeOrder({ sellerId: seller.id });

    const response = await call("./orders/[id]/route", "GET", `/api/orders/${order.id}`, {
      headers: authHeaderFor(seller),
      params: { id: String(order.id) },
    });

    expect(response.status).toBe(200);
  });
```

- [ ] **Step 8: Update the API types**

In `src/types/api.ts`, replace `Order`, `OrderItem`, `OrderDetail` and `CreatedOrder`. **Leave `SellerOrderItem` and `SellerOrder` exactly as they are** — the seller route still returns items, and it moves in Task 6. `OrderItem` is deleted here because `OrderDetail` was its only consumer; `SellerOrderItem` still derives from `OrderItemRow`, so that import stays until Task 9.

```ts
// ─── Orders ───────────────────────────────────────────────────────────────────

export type OrderStatus = OrderRow["status"];

/**
 * `GET /api/orders`.
 *
 * Three timestamps rather than one: `expiresAt` is when the reservation lapses and
 * `updatedAt` is when the status last moved, and both arrive as ISO strings like
 * `createdAt`.
 */
export type Order = Omit<Serialized<OrderRow>, "expiresAt" | "updatedAt"> & {
  expiresAt: string;
  updatedAt: string;
};

/** `GET /api/orders/[id]` — the order plus the listing it is for. */
export type OrderDetail = Order & {
  listingTitle: string;
  coverImageId: number | null;
};

/** `POST /api/orders` — only the id is consumed by the UI. */
export type CreatedOrder = Pick<Order, "id">;
```

For one task `SellerOrder` therefore claims fields the seller route does not yet send. That is deliberate and it is why Task 6 comes next: the alternative is one task large enough that a reviewer cannot hold it.

- [ ] **Step 9: Write the failing component test**

Create `src/components/orders/OrderActions.component.test.tsx`:

```tsx
/**
 * Part 3 spec §5.3 — the buttons follow the graph.
 *
 * The component holds no rules of its own: it asks `canTransition` what this actor may
 * do from this status, so a change to the graph cannot leave the UI offering something
 * the API refuses.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import OrderActions from "./OrderActions";

describe("OrderActions — a pending order", () => {
  it("offers the seller confirm and decline, and nothing else", () => {
    render(<OrderActions status="pending" actor="seller" onTransition={vi.fn()} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Confirm order",
      "Decline order",
    ]);
  });

  it("offers the buyer only cancel", () => {
    render(<OrderActions status="pending" actor="buyer" onTransition={vi.fn()} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Cancel order",
    ]);
  });

  it("never offers the buyer a way to confirm their own purchase", () => {
    render(<OrderActions status="pending" actor="buyer" onTransition={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Confirm order" })).toBeNull();
  });
});

describe("OrderActions — later states", () => {
  it("offers the seller shipping and cancellation once confirmed", () => {
    render(<OrderActions status="confirmed" actor="seller" onTransition={vi.fn()} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Mark as shipped",
      "Cancel order",
    ]);
  });

  it("offers the buyer receipt once shipped", () => {
    render(<OrderActions status="shipped" actor="buyer" onTransition={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Mark as received" })).toBeInTheDocument();
  });

  it("offers nothing at all on a terminal order", () => {
    for (const status of ["completed", "cancelled", "declined", "expired"] as const) {
      const { unmount } = render(
        <OrderActions status={status} actor="admin" onTransition={vi.fn()} />,
      );
      expect(screen.queryAllByRole("button"), status).toHaveLength(0);
      unmount();
    }
  });
});

describe("OrderActions — behaviour", () => {
  it("reports the status it is asking for", async () => {
    const onTransition = vi.fn();
    render(<OrderActions status="pending" actor="seller" onTransition={onTransition} />);

    await userEvent.click(screen.getByRole("button", { name: "Decline order" }));

    expect(onTransition).toHaveBeenCalledWith("declined");
  });

  it("disables every button while one is in flight", () => {
    render(<OrderActions status="pending" actor="seller" busy onTransition={vi.fn()} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
```

- [ ] **Step 10: Write the component**

Create `src/components/orders/OrderActions.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui";
import {
  canTransition,
  type OrderActor,
  type OrderStatus,
} from "@/lib/order-lifecycle";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderActionsProps = {
  status: OrderStatus;
  /** The viewer's relationship to this order, not their role. */
  actor: OrderActor;
  /** A transition is in flight; every control is disabled until it settles. */
  busy?: boolean;
  onTransition: (to: OrderStatus) => void;
};

// ─── Actions ──────────────────────────────────────────────────────────────────
// Every transition a human can drive, in the order they should be offered. Which of them
// appear is `canTransition`'s decision — this list only supplies the wording, so the UI
// cannot offer something the API will refuse.

const ACTIONS: Array<{
  to: OrderStatus;
  label: string;
  variant: "primary" | "secondary" | "danger";
}> = [
  { to: "confirmed", label: "Confirm order", variant: "primary" },
  { to: "shipped", label: "Mark as shipped", variant: "primary" },
  { to: "completed", label: "Mark as received", variant: "primary" },
  { to: "declined", label: "Decline order", variant: "danger" },
  { to: "cancelled", label: "Cancel order", variant: "danger" },
  { to: "expired", label: "Mark as expired", variant: "secondary" },
];

// ─── Component ────────────────────────────────────────────────────────────────

/** The transitions this actor may drive from this status. Renders nothing if none. */
export default function OrderActions({
  status,
  actor,
  busy = false,
  onTransition,
}: OrderActionsProps) {
  const available = ACTIONS.filter((action) =>
    canTransition(status, action.to, actor),
  );

  if (available.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {available.map((action) => (
        <Button
          key={action.to}
          variant={action.variant}
          size="sm"
          disabled={busy}
          onClick={() => onTransition(action.to)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
```

`Button` already takes `variant` (`primary | secondary | danger | ghost`), `size`, `disabled` and `onClick` — nothing needs adding to it.

- [ ] **Step 11: Update the two buyer-facing pages**

`src/app/(frontend)/orders/page.tsx` — the list. Replace `order.totalPrice` with `order.price` in both places (the formatted amount and the converted one). Nothing else changes.

`src/app/(frontend)/orders/[id]/page.tsx` — replace the "Order Items" section and the totals block. The page now shows one listing and the actions available to the viewer:

```tsx
  const { user } = useAuth();

  const actor: OrderActor | null =
    !order || !user
      ? null
      : user.role === "admin"
        ? "admin"
        : user.id === order.buyerId
          ? "buyer"
          : user.id === order.sellerId
            ? "seller"
            : null;

  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);

  async function handleTransition(to: OrderStatus) {
    if (!order) return;
    setPendingStatus(to);
    try {
      // The route returns the order row, without the joined listing title — merging keeps
      // the fields the page already has rather than blanking them.
      const updated = await api.put<Order>(`/api/orders/${order.id}`, { status: to });
      setData({ ...order, ...updated });
      toast.success(`Order #${order.id} is now ${updated.status}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update the order");
    } finally {
      setPendingStatus(null);
    }
  }
```

with the details block reading:

```tsx
      <div className="grid gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        <p>
          <span className="font-medium text-zinc-900">Listing:</span>{" "}
          <Link href={`/listings/${order.listingId}`} className="text-indigo-700 hover:underline">
            {order.listingTitle}
          </Link>
        </p>
        <p>
          <span className="font-medium text-zinc-900">Placed:</span>{" "}
          {new Date(order.createdAt).toLocaleString()}
        </p>
        <p>
          <span className="font-medium text-zinc-900">Price:</span> ${Number(order.price).toFixed(2)}{" "}
          <span className="text-zinc-500">({formatConverted(Number(order.price))})</span>
        </p>
        {order.status === "pending" && (
          <p>
            <span className="font-medium text-zinc-900">Reservation expires:</span>{" "}
            {new Date(order.expiresAt).toLocaleString()}
          </p>
        )}
      </div>

      {actor && (
        <OrderActions
          status={order.status}
          actor={actor}
          busy={pendingStatus !== null}
          onTransition={handleTransition}
        />
      )}
```

`useFetch` returns `setData`; the existing destructure takes only `data`, `loading` and `error`, so add `setData` to it. Add these imports: `useState` from `react`, `Link` from `next/link`, `toast` from `react-hot-toast`, `api` from `@/lib/api`, `useAuth` from `@/context/AuthContext`, `OrderActions` from `@/components/orders/OrderActions`, `type Order` and `type OrderDetail` from `@/types/api`, and `type OrderActor` and `type OrderStatus` from `@/lib/order-lifecycle`.

- [ ] **Step 12: Run everything**

Run: `npm run test:unit -- src/lib/authorization.test.ts`
Expected: PASS.

Run: `npm run test:component -- src/components/orders/OrderActions.component.test.tsx`
Expected: PASS.

Run: `npm run test:integration -- "src/app/api/orders/[id]/route.integration.test.ts" src/app/api/rbac.integration.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 13: Prove the side effect is transactional**

In the route's `PUT`, temporarily move the `applyListingSideEffect` call outside the `db.transaction` callback and make the order update throw immediately after it by adding `throw new Error("boom")` as the last line inside the callback.

Run: `npm run test:integration -- "src/app/api/orders/[id]/route.integration.test.ts" -t "lets the seller confirm"`
Expected: FAIL — a 500, and the listing left `sold` against a still-pending order.

Restore both edits and re-run; expected PASS.

- [ ] **Step 14: Commit**

```bash
git add src/lib/authorization.ts src/lib/authorization.test.ts \
  "src/app/api/orders/[id]/route.ts" "src/app/api/orders/[id]/route.integration.test.ts" \
  src/app/api/rbac.integration.test.ts src/types/api.ts \
  src/components/orders/OrderActions.tsx src/components/orders/OrderActions.component.test.tsx \
  "src/app/(frontend)/orders/page.tsx" "src/app/(frontend)/orders/[id]/page.tsx"
git commit -m "feat(orders): transitions, with the listing side effect in the same transaction"
```

---

### Task 6: The seller dashboard

Three queries and a reconciliation become one query and a `WHERE`.

**Files:**
- Modify: `src/app/api/orders/seller/route.ts` (whole file)
- Modify: `src/types/api.ts` (the `SellerOrderItem` and `SellerOrder` types)
- Modify: `src/components/orders/OrderCard.tsx`, `src/components/seller/SellerOrdersTab.tsx`
- Test: `src/app/api/orders/seller/route.integration.test.ts` (create)

**Interfaces:**
- Consumes: `orders.sellerId` (Task 2); `OrderActions` from `@/components/orders/OrderActions` (Task 5).
- Produces: `SellerOrder = Order & { buyerName: string; buyerEmail: string; listingTitle: string; coverImageId: number | null }`. `SellerOrderItem` is deleted.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/orders/seller/route.integration.test.ts`:

```ts
/**
 * Part 3 spec §5.5 — the seller dashboard is a column filter now.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { authHeaderFor } from "@/test/auth";
import { resetDb } from "@/test/db";
import { makeListing, makeOrder, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

type Row = {
  id: number;
  sellerId: number;
  listingTitle: string;
  buyerName: string;
  buyerEmail: string;
  price: string;
  status: string;
  coverImageId: number | null;
};

async function sales(headers: Record<string, string> = {}) {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest("http://localhost/api/orders/seller", { headers }),
  );
  return { status: response.status, body: (await response.json()) as Row[] };
}

describe("GET /api/orders/seller", () => {
  it("returns the caller's own sales, with the buyer and the listing joined in", async () => {
    const seller = await makeUser({ role: "seller", name: "Sam" });
    const buyer = await makeUser({ role: "buyer", name: "Bea", email: "bea@example.test" });
    const listing = await makeListing({ sellerId: seller.id, title: "Road bike", price: "500.00" });
    const order = await makeOrder({
      buyerId: buyer.id,
      sellerId: seller.id,
      listingId: listing.id,
      status: "pending",
    });

    const { status, body } = await sales(authHeaderFor(seller));

    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: order.id,
      listingTitle: "Road bike",
      buyerName: "Bea",
      buyerEmail: "bea@example.test",
      price: "500.00",
      status: "pending",
    });
  });

  it("excludes another seller's sales", async () => {
    const mine = await makeUser({ role: "seller" });
    const theirs = await makeUser({ role: "seller" });
    const own = await makeOrder({ sellerId: mine.id });
    await makeOrder({ sellerId: theirs.id });

    const { body } = await sales(authHeaderFor(mine));

    expect(body.map((o) => o.id)).toEqual([own.id]);
  });

  it("excludes the seller's own purchases", async () => {
    // A seller who buys something sees it under /api/orders, not here. This endpoint
    // answers "what am I selling".
    const seller = await makeUser({ role: "seller" });
    await makeOrder({ buyerId: seller.id });

    const { body } = await sales(authHeaderFor(seller));

    expect(body).toHaveLength(0);
  });

  it("returns an empty array for a seller with no sales", async () => {
    const seller = await makeUser({ role: "seller" });
    const { status, body } = await sales(authHeaderFor(seller));

    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("returns every sale to an admin", async () => {
    const admin = await makeUser({ role: "admin" });
    await makeOrder();
    await makeOrder();

    const { body } = await sales(authHeaderFor(admin));

    expect(body).toHaveLength(2);
  });

  it("sorts newest first, deterministically", async () => {
    // Two orders placed in the same millisecond share a `created_at`, so `id` breaks the
    // tie. Without it this assertion would pass or fail depending on the planner.
    const seller = await makeUser({ role: "seller" });
    const first = await makeOrder({ sellerId: seller.id });
    const second = await makeOrder({ sellerId: seller.id });

    const { body } = await sales(authHeaderFor(seller));

    expect(body.map((o) => o.id)).toEqual([second.id, first.id]);
  });

  it("answers 401 unauthenticated and 403 to a buyer", async () => {
    const buyer = await makeUser({ role: "buyer" });

    expect((await sales()).status).toBe(401);
    expect((await sales(authHeaderFor(buyer))).status).toBe(403);
  });
});
```

`makeOrder({ sellerId })` sets the order's `seller_id` and leaves the listing it creates owned by somebody else. That is what the scoping cases want — they are asserting on the column, which is the whole point of D1 — and it is why the cases that also care about the joined listing pass `listingId` as well.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- src/app/api/orders/seller/route.integration.test.ts`
Expected: FAIL — the response has `items` and no `listingTitle`.

- [ ] **Step 3: Rewrite the route**

Replace the handler in `src/app/api/orders/seller/route.ts`. In its `@swagger` block, delete the whole `items` array property and put the flat fields in its place — `listingId`, `listingTitle`, `coverImageId` (`nullable: true`) — and rename `totalPrice` to `price`, adding `sellerId` and `expiresAt` beside it.

```ts
import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { coverImageIdsFor } from "@/db/listing-images";
import { listings, orders, users } from "@/db/schema";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { jsonOk, jsonError } from "@/lib/response";

export async function GET(request: NextRequest) {
  try {
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    // One query. This used to be three — every listing the seller owns, every order item
    // touching one of them, then the orders behind those items — plus a reconciliation in
    // Node. `seller_id` on the order is what D1 bought.
    const rows = await db
      .select({
        id: orders.id,
        buyerId: orders.buyerId,
        sellerId: orders.sellerId,
        listingId: orders.listingId,
        price: orders.price,
        status: orders.status,
        expiresAt: orders.expiresAt,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        buyerName: users.name,
        buyerEmail: users.email,
        listingTitle: listings.title,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.buyerId))
      .innerJoin(listings, eq(listings.id, orders.listingId))
      .where(payload.role === "admin" ? undefined : eq(orders.sellerId, payload.sub))
      // `id` breaks the tie: two orders placed in the same millisecond share a
      // `created_at`, and a dashboard that reshuffles between refreshes is a bug report.
      .orderBy(desc(orders.createdAt), desc(orders.id));

    const covers = await coverImageIdsFor(rows.map((row) => row.listingId));

    return jsonOk(
      rows.map((row) => ({
        ...row,
        coverImageId: covers.get(row.listingId) ?? null,
      })),
    );
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[GET /api/orders/seller]", err);
    return jsonError("Internal server error");
  }
}
```

- [ ] **Step 4: Update the types**

In `src/types/api.ts`, delete `SellerOrderItem`, remove `OrderItem as OrderItemRow` from the schema import at the top of the file (nothing derives from it any more), and replace `SellerOrder`:

```ts
/** `GET /api/orders/seller` — the buyer and the listing are joined in. */
export type SellerOrder = Order & {
  buyerName: string;
  buyerEmail: string;
  listingTitle: string;
  coverImageId: number | null;
};
```

- [ ] **Step 5: Rewrite the seller order card**

`src/components/orders/OrderCard.tsx` shows one listing rather than a list of lines, and delegates its buttons to `OrderActions` so the dashboard and the order page cannot disagree about what a seller may do:

```tsx
"use client";

import Image from "next/image";

import OrderActions from "@/components/orders/OrderActions";
import { StatusBadge } from "@/components/ui";
import type { OrderStatus } from "@/lib/order-lifecycle";
import type { SellerOrder } from "@/types/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderCardProps = {
  order: SellerOrder;
  formatConverted: (amount: number) => string;
  updating?: boolean;
  onTransition: (to: OrderStatus) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

/** A seller-facing order: the buyer, the listing sold, and what the seller may do next. */
export default function OrderCard({
  order,
  formatConverted,
  updating = false,
  onTransition,
}: OrderCardProps) {
  const price = Number(order.price);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Order #{order.id}</h3>
          <p className="text-xs text-zinc-500">
            {new Date(order.createdAt).toLocaleString()} · Buyer:{" "}
            <span className="font-medium text-zinc-700">{order.buyerName}</span>{" "}
            ({order.buyerEmail})
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        {order.coverImageId !== null && (
          <Image
            src={`/api/images/${order.coverImageId}`}
            alt=""
            width={56}
            height={56}
            unoptimized
            className="h-14 w-14 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-800">{order.listingTitle}</p>
          <p className="text-xs text-zinc-500">
            ${price.toFixed(2)} ({formatConverted(price)})
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 bg-zinc-50/50 px-4 py-3">
        <OrderActions
          status={order.status}
          actor="seller"
          busy={updating}
          onTransition={onTransition}
        />
      </div>
    </div>
  );
}
```

The `alt=""` is deliberate: the listing title sits beside the thumbnail, so a screen reader that announced it twice would be reading the same fact twice. `unoptimized` is Part 2's decision — `/api/images/{id}` is auth-aware and must not pass through a shared, auth-blind optimiser cache.

- [ ] **Step 6: Rewrite the seller orders tab**

In `src/components/seller/SellerOrdersTab.tsx`, replace `handleStatusUpdate` and the two `OrderCard` usages:

```tsx
  async function handleTransition(orderId: number, to: OrderStatus) {
    try {
      setUpdatingOrderId(orderId);
      const updated = await api.put<SellerOrder>(`/api/orders/${orderId}`, { status: to });

      setData((current) =>
        (current ?? []).map((order) =>
          order.id === orderId ? { ...order, status: updated.status } : order,
        ),
      );

      toast.success(`Order #${orderId} is now ${updated.status}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update the order";
      toast.error(msg);
    } finally {
      setUpdatingOrderId(null);
    }
  }
```

```tsx
                  <OrderCard
                    key={order.id}
                    order={order}
                    formatConverted={formatConverted}
                    updating={updatingOrderId === order.id}
                    onTransition={(to) => handleTransition(order.id, to)}
                  />
```

Both sections use the same call now — the processed list gets `OrderActions` too, which correctly renders nothing for a terminal order and correctly offers "Mark as shipped" on a confirmed one. Rename the second heading from "Processed Orders" to "Other Orders", since the list no longer means "nothing left to do".

The split stays as it is: `pendingOrders` filters `status === "pending"`, `processedOrders` takes the rest.

- [ ] **Step 7: Run everything**

Run: `npm run test:integration -- src/app/api/orders/seller/route.integration.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm test`
Expected: PASS. Foreground, no background flag, no polling; six to eight minutes is normal.

- [ ] **Step 8: Prove the scoping test can fail**

Change the route's `where` to `payload.role === "admin" ? undefined : eq(orders.buyerId, payload.sub)` — the mistake a copy of `GET /api/orders` would make.

Run: `npm run test:integration -- src/app/api/orders/seller/route.integration.test.ts -t "excludes the seller's own purchases"`
Expected: FAIL — the seller's purchase appears among their sales.

Restore the line and re-run; expected PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/orders/seller/route.ts src/app/api/orders/seller/route.integration.test.ts \
  src/types/api.ts src/components/orders/OrderCard.tsx src/components/seller/SellerOrdersTab.tsx
git commit -m "feat(orders): the seller dashboard is a column filter"
```

---

### Task 7: The sweep

D4 in one file: this exists so listings return to browse promptly, **not** so the data stays correct. The reserve path already guarantees that.

**Files:**
- Create: `src/db/expire-reservations.ts`
- Test: `src/db/expire-reservations.integration.test.ts`
- Modify: `package.json` (one script line)

**Interfaces:**
- Consumes: `expireStalePendingOrders`, `releaseUnheldListings` from `@/db/orders` (Task 3).
- Produces: `expireReservations(): Promise<{ expiredOrders: number; releasedListings: number }>`, and `npm run db:expire-reservations`.

- [ ] **Step 1: Write the failing test**

Create `src/db/expire-reservations.integration.test.ts`:

```ts
/**
 * Part 3 spec §5.4 — the scheduled sweep.
 *
 * Same shape as `prune-tokens.integration.test.ts`: the function is the unit, the script
 * wrapper is not, and the cutoff is Postgres's rather than Node's.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { expireReservations } from "@/db/expire-reservations";
import { listings, orders } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeOrder } from "@/test/factories";

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb();
});

async function statusOf(listingId: number): Promise<string> {
  const db = await getTestDb();
  const [row] = await db
    .select({ status: listings.status })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  return row.status;
}

describe("expireReservations", () => {
  it("expires a lapsed order and returns its listing to browse", async () => {
    const db = await getTestDb();
    const listing = await makeListing({ status: "reserved" });
    const order = await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() - HOUR),
    });

    const result = await expireReservations();

    expect(result).toEqual({ expiredOrders: 1, releasedListings: 1 });

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("expired");
    expect(await statusOf(listing.id)).toBe("active");
  });

  it("leaves a live reservation alone", async () => {
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() + HOUR),
    });

    expect(await expireReservations()).toEqual({ expiredOrders: 0, releasedListings: 0 });
    expect(await statusOf(listing.id)).toBe("reserved");
  });

  it("releases a listing left reserved by an order that is already terminal", async () => {
    // The state a deleted or hand-edited order leaves behind. The sweep is what notices.
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({ listingId: listing.id, status: "cancelled" });

    const result = await expireReservations();

    expect(result).toEqual({ expiredOrders: 0, releasedListings: 1 });
    expect(await statusOf(listing.id)).toBe("active");
  });

  it("expires and releases across many listings in one pass", async () => {
    for (let i = 0; i < 3; i++) {
      const listing = await makeListing({ status: "reserved" });
      await makeOrder({
        listingId: listing.id,
        status: "pending",
        expiresAt: new Date(Date.now() - HOUR),
      });
    }

    expect(await expireReservations()).toEqual({ expiredOrders: 3, releasedListings: 3 });
  });

  it("is a no-op on a marketplace with nothing to sweep", async () => {
    await makeListing();
    expect(await expireReservations()).toEqual({ expiredOrders: 0, releasedListings: 0 });
  });

  it("changes nothing that a second run would change again", async () => {
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() - HOUR),
    });

    await expireReservations();
    const second = await expireReservations();

    expect(second).toEqual({ expiredOrders: 0, releasedListings: 0 });
  });

  it("runs the two steps in order, so a just-expired order releases its listing", async () => {
    // Releasing before expiring would find the order still `pending` and leave the
    // listing held until the next run — an hour of a listing nobody can buy.
    const listing = await makeListing({ status: "reserved" });
    await makeOrder({
      listingId: listing.id,
      status: "pending",
      expiresAt: new Date(Date.now() - HOUR),
    });

    const result = await expireReservations();

    expect(result.releasedListings).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- src/db/expire-reservations.integration.test.ts`
Expected: FAIL — `Failed to resolve import "@/db/expire-reservations"`.

- [ ] **Step 3: Write the script**

Create `src/db/expire-reservations.ts`:

```ts
/**
 * Part 3 — release listings whose reservations have lapsed (spec §5.4).
 *
 * This is a convenience, not a correctness mechanism (D4). `POST /api/orders` expires and
 * releases whatever is holding the listing it is about to claim, inside its own
 * transaction, so the data is correct whether or not this ever runs. What it buys is
 * promptness: without it, a listing whose buyer went quiet stays out of browse until some
 * *other* buyer happens to try to order it, which is exactly the buyer who cannot see it.
 *
 * Run as `npm run db:expire-reservations`. A cron entry every ten minutes is ample for a
 * 48-hour deadline.
 */
import { db } from "./index";
import { expireStalePendingOrders, releaseUnheldListings } from "./orders";

export type SweepResult = {
  expiredOrders: number;
  releasedListings: number;
};

/**
 * Expires every pending order past its deadline, then releases every listing nothing
 * pending is holding any more.
 *
 * The order matters and the transaction matters: releasing first would find the lapsed
 * orders still `pending` and leave their listings held until the next run. Both steps run
 * as one so a crash between them cannot leave an expired order beside a reserved listing.
 *
 * The cutoff is computed by Postgres, not Node — see `prune-tokens.ts` for why this
 * project does not trust the container clock.
 */
export async function expireReservations(): Promise<SweepResult> {
  return db.transaction(async (tx) => {
    const expiredOrders = await expireStalePendingOrders(tx);
    const releasedListings = await releaseUnheldListings(tx);
    return { expiredOrders, releasedListings };
  });
}

// Run only when invoked directly, so importing this module from a test does not sweep
// anything.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  expireReservations()
    .then(({ expiredOrders, releasedListings }) => {
      console.log(
        `Expired ${expiredOrders} reservation${expiredOrders === 1 ? "" : "s"}; ` +
          `returned ${releasedListings} listing${releasedListings === 1 ? "" : "s"} to browse.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed to expire reservations:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, after `"db:prune-tokens"`:

```json
    "db:expire-reservations": "tsx src/db/expire-reservations.ts"
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:integration -- src/db/expire-reservations.integration.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Prove the ordering test can fail**

Swap the two statements inside `expireReservations` so the release runs first.

Run: `npm run test:integration -- src/db/expire-reservations.integration.test.ts -t "runs the two steps in order"`
Expected: FAIL — `releasedListings` is 0.

Restore the order and re-run; expected PASS.

- [ ] **Step 7: Check the script actually runs**

The guard that decides "was I invoked directly" is copied from `prune-tokens.ts` and is easy to get subtly wrong, in which case the command silently does nothing and exits 0 — indistinguishable from a clean sweep.

Point it at a database that does not exist, so the check proves the main path ran without writing to anything:

```bash
DATABASE_URL=postgres://nobody@127.0.0.1:1/nowhere npm run db:expire-reservations
```

Expected: `Failed to expire reservations: ...` on stderr and a non-zero exit. Silence and exit 0 means the guard never fired and the script is dead code.

**Do not run this against `DATABASE_URL` as configured.** That is the developer's own database, the sweep writes to it, and this project has already ruled twice that verification steps do not touch it.

- [ ] **Step 8: Commit**

```bash
git add src/db/expire-reservations.ts src/db/expire-reservations.integration.test.ts package.json
git commit -m "feat(orders): sweep lapsed reservations back into browse"
```

---

### Task 8: Downstream reads, and what `reserved` means everywhere else

Four consumers still reason about orders the old way, and one new listing status has to mean something to every read path.

**Files:**
- Modify: `src/lib/listing-visibility.ts`, `src/lib/listing-visibility.test.ts`
- Modify: `src/app/api/listings/[id]/route.ts` (the `GET` visibility check, and a guard in `PUT`)
- Modify: `src/app/api/images/[id]/route.ts:63`
- Modify: `src/app/api/recommendations/route.ts`
- Modify: `src/app/api/listings/[id]/reviews/route.ts`
- Delete: `src/lib/review-eligibility.ts`, `src/lib/review-eligibility.test.ts`
- Test: `src/app/api/listings/[id]/reserved.integration.test.ts` (create)

**Interfaces:**
- Consumes: `applyListingSideEffect` is not needed here; only the enum value `reserved` (Task 2) and `orders.listingId` / `orders.status`.
- Produces: `PUBLIC_LISTING_STATUSES` and `isPubliclyVisible(status)` in `@/lib/listing-visibility`.

- [ ] **Step 1: Write the failing visibility unit test**

Append to `src/lib/listing-visibility.test.ts`:

```ts
describe("isPubliclyVisible", () => {
  it("publishes active, reserved and sold", () => {
    // Reserved and sold listings were public while they were for sale. Un-publishing them
    // the moment somebody buys would break the buyer's own order page and the seller's
    // record of what they sold.
    expect(isPubliclyVisible("active")).toBe(true);
    expect(isPubliclyVisible("reserved")).toBe(true);
    expect(isPubliclyVisible("sold")).toBe(true);
  });

  it("keeps drafts and removed listings private", () => {
    // A draft was never published, and `removed` is the seller's decision to unpublish.
    expect(isPubliclyVisible("draft")).toBe(false);
    expect(isPubliclyVisible("removed")).toBe(false);
  });

  it("names every status exactly once", () => {
    // The list and the enum have to move together: a status missing from both branches
    // would default to whichever side the caller happened to write.
    expect([...PUBLIC_LISTING_STATUSES].sort()).toEqual(["active", "reserved", "sold"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:unit -- src/lib/listing-visibility.test.ts`
Expected: FAIL — `isPubliclyVisible is not exported`.

- [ ] **Step 3: Add the predicate**

In `src/lib/listing-visibility.ts`, add at the top of the file after the imports:

```ts
import type { Listing } from "@/db/schema";

type ListingStatus = Listing["status"];

/**
 * The statuses a listing is publicly readable in.
 *
 * `GET /api/listings/{id}` and `GET /api/images/{id}` used to disagree about this: the
 * detail route hid a `sold` listing from everyone but its owner while the image route
 * served its photos to the world. Part 3 makes confirming an order mark the listing
 * `sold`, so the stricter of the two would have made every completed purchase's listing
 * unreachable from the buyer's own order. One list, both routes.
 *
 * This is about *reading one listing*. Browse and search still show `active` only — a
 * held or sold object is not for sale, and `listings-query.ts` filters it out.
 */
export const PUBLIC_LISTING_STATUSES = ["active", "reserved", "sold"] as const;

export function isPubliclyVisible(status: ListingStatus): boolean {
  return (PUBLIC_LISTING_STATUSES as readonly string[]).includes(status);
}
```

Import it in the test file alongside `resolveListingVisibility`.

- [ ] **Step 4: Use it in both routes**

`src/app/api/listings/[id]/route.ts`, in `GET`, replace the visibility check:

```ts
    // Published listings are readable by anyone; drafts and removed listings only by
    // their owner or an admin. See PUBLIC_LISTING_STATUSES for why `sold` is public.
    if (!isPubliclyVisible(listing.status) && !isOwnerOrAdmin) {
      return jsonError("Listing not found", 404);
    }
```

`src/app/api/images/[id]/route.ts`, replace line 63 and the comment above it:

```ts
    // `active`, `reserved` and `sold` are all legitimately published — a purchase must
    // not un-publish a photo out from under the buyer's order history. `draft` and
    // `removed` are private to the owner/admin. Same message and status as a missing
    // row: the response must not reveal that the id exists.
    const isPublished = isPubliclyVisible(status);
```

Add `import { isPubliclyVisible } from "@/lib/listing-visibility";` to both.

- [ ] **Step 5: Write the failing reserved-listing test**

Create `src/app/api/listings/[id]/reserved.integration.test.ts`:

```ts
/**
 * Part 3 — what `reserved` means to the listing routes.
 *
 * A reservation nobody but the order lifecycle can clear is the only kind worth having:
 * if the seller can press Disable while a buyer waits, the 409 the buyer got is a
 * promise the marketplace does not keep.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { listings } from "@/db/schema";
import { authHeaderFor } from "@/test/auth";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeListingImage, makeUser } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function readListing(id: number, headers: Record<string, string> = {}) {
  const { GET } = await import("./route");
  const response = await GET(
    new NextRequest(`http://localhost/api/listings/${id}`, { headers }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status };
}

async function editListing(id: number, headers: Record<string, string>, body: unknown) {
  const { PUT } = await import("./route");
  const response = await PUT(
    new NextRequest(`http://localhost/api/listings/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status };
}

async function readImage(id: number, headers: Record<string, string> = {}) {
  const { GET } = await import("../../images/[id]/route");
  const response = await GET(
    new NextRequest(`http://localhost/api/images/${id}`, { headers }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status };
}

describe("a reserved or sold listing is still public", () => {
  it("serves the detail page to an anonymous visitor", async () => {
    for (const status of ["reserved", "sold"] as const) {
      const listing = await makeListing({ status });
      expect((await readListing(listing.id)).status, status).toBe(200);
    }
  });

  it("still hides drafts and removed listings from strangers", async () => {
    for (const status of ["draft", "removed"] as const) {
      const listing = await makeListing({ status });
      expect((await readListing(listing.id)).status, status).toBe(404);
    }
  });

  it("still shows a draft to its own seller", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "draft" });

    expect((await readListing(listing.id, authHeaderFor(seller))).status).toBe(200);
  });
});

describe("a reserved listing's photos stay served", () => {
  it("serves an image on a reserved listing to an anonymous visitor", async () => {
    // The buyer holding the reservation has to be able to look at what they claimed.
    const listing = await makeListing({ status: "reserved" });
    const image = await storedImageOn(listing.id);

    expect((await readImage(image.id)).status).toBe(200);
  });

  it("still refuses an image on a draft listing", async () => {
    const listing = await makeListing({ status: "draft" });
    const image = await storedImageOn(listing.id);

    expect((await readImage(image.id)).status).toBe(404);
  });
});
```

`makeListingImage` inserts a row and puts nothing in storage, so a row alone answers 404 from the "the object has vanished" branch — the same status as the visibility refusal, which would make both cases above assert nothing. This helper puts real bytes through the configured provider (the memory driver under `NODE_ENV=test`) and hangs the row off the key it returns:

```ts
async function storedImageOn(listingId: number) {
  const stored = await getStorageProvider().put(Buffer.from("not really a webp"), {
    contentType: "image/webp",
    prefix: `listings/${listingId}`,
  });

  return makeListingImage({
    listingId,
    storageKey: stored.key,
    contentType: stored.contentType,
    byteSize: stored.byteSize,
  });
}
```

The provider generates the key, which is why the row is created second. The bytes are never decoded on the way out — `GET /api/images/{id}` serves what it stored — so they do not have to be a real WebP. Import `getStorageProvider` from `@/lib/storage`.

The last describe in the same file:

```ts
describe("a reserved listing cannot be re-statused by its seller", () => {
  it("refuses the seller's status change with 409", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "reserved" });

    const { status } = await editListing(listing.id, authHeaderFor(seller), {
      status: "removed",
    });

    expect(status).toBe(409);

    const db = await getTestDb();
    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.status).toBe("reserved");
  });

  it("still lets the seller edit everything else", async () => {
    // The order captured its own price, so an edit cannot change what the buyer owes.
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "reserved" });

    const { status } = await editListing(listing.id, authHeaderFor(seller), {
      title: "Road bike, barely used",
    });

    expect(status).toBe(200);
  });

  it("lets an admin change it anyway", async () => {
    const admin = await makeUser({ role: "admin" });
    const listing = await makeListing({ status: "reserved" });

    const { status } = await editListing(listing.id, authHeaderFor(admin), {
      status: "removed",
    });

    expect(status).toBe(200);
  });

  it("leaves an active listing's status editable", async () => {
    const seller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: seller.id, status: "active" });

    const { status } = await editListing(listing.id, authHeaderFor(seller), {
      status: "removed",
    });

    expect(status).toBe(200);
  });
});
```

- [ ] **Step 6: Add the guard**

In `src/app/api/listings/[id]/route.ts`'s `PUT`, immediately after `const { title, description, price, categoryId, status } = parsed.data;` — the guard needs the parsed body, so it cannot sit beside the `canMutateListing` check above it:

```ts
    // A reservation the seller can dissolve by pressing Disable is not a reservation. The
    // buyer's order is what clears this — decline it, cancel it, or let it lapse. Admins
    // are unrestricted, as everywhere else.
    if (listing.status === "reserved" && status !== undefined && !isAdmin(payload)) {
      return jsonError(
        "This listing is reserved by a pending order. Decline or cancel the order first.",
        409,
      );
    }
```

Add `isAdmin` to the existing `@/lib/authorization` import, and add `409` to the `PUT` block's documented responses:

```
 *       409:
 *         description: The listing is reserved by a pending order
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
```

- [ ] **Step 7: Move recommendations off the join table**

In `src/app/api/recommendations/route.ts`, replace the ordered arm of the `Promise.all`:

```ts
      db
        .select({ id: listings.id, embedding: listings.embedding, at: orders.createdAt })
        .from(orders)
        .innerJoin(listings, eq(orders.listingId, listings.id))
        .where(eq(orders.buyerId, userId))
        .orderBy(desc(orders.createdAt))
        .limit(MAX_INTERACTIONS),
```

and replace the `ownedIds` line:

```ts
    // Excluded from results because the user has them or has a claim on them. A declined,
    // cancelled or expired order is the opposite: the listing went back into browse and
    // this buyer is exactly the person who wanted it. Reviewing is NOT owning either — a
    // user may well want a second one — so reviewed listings stay in the pool.
    const HOLDING: readonly OrderStatus[] = ["pending", "confirmed", "shipped", "completed"];
    const ownedIds = orderedRows
      .filter((row) => HOLDING.includes(row.status))
      .map((row) => row.id);
```

which means the ordered arm also selects `status: orders.status`, and `Timed` gains nothing — `status` lives on `orderedRows`, not on the interaction. Declare the arm's row type inline rather than widening `Timed`:

```ts
      db
        .select({
          id: listings.id,
          embedding: listings.embedding,
          at: orders.createdAt,
          status: orders.status,
        })
```

Import `type OrderStatus` from `@/lib/order-lifecycle`. Remove `orderItems` from the schema import; leave `inArray` and the rest alone.

Add one case to `src/app/api/recommendations/route.integration.test.ts`:

```ts
  it("recommends a listing whose order was declined, because it is back in browse", async () => {
    const buyer = await makeUser({ role: "buyer" });
    const wanted = inCluster("cycling")[0];
    await makeOrder({ buyerId: buyer.id, listingId: wanted.id, status: "completed" });
    const declined = inCluster("cycling")[1];
    await makeOrder({ buyerId: buyer.id, listingId: declined.id, status: "declined" });

    const { body } = await recommend(authHeaderFor(buyer), "limit=20");

    expect(body.data.map((r) => r.id)).toContain(declined.id);
    expect(body.data.map((r) => r.id)).not.toContain(wanted.id);
  });
```

- [ ] **Step 8: Make review eligibility one enum value**

In `src/app/api/listings/[id]/reviews/route.ts`, replace the eligibility block:

```ts
    // Only a buyer who actually received this listing may review it. `completed` is the
    // whole rule now — the hand-maintained list of "statuses that count as purchased" is
    // gone, and with it the chance of the list and the graph disagreeing.
    const [purchase] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.listingId, listingId),
          eq(orders.buyerId, payload.sub),
          eq(orders.status, "completed"),
        ),
      )
      .limit(1);

    if (!purchase) {
      return jsonError("You can only review a listing you have received", 403);
    }
```

Change the `POST` handler's gate from `authorize("buyer")(payload);` to nothing — delete that line, keeping `authenticate`. D5 makes sellers buyers, and a seller who completed a purchase has exactly the same standing to review it as anyone else. Add a comment saying so:

```ts
    // No role gate: sellers buy too (D5). The eligibility query below is the real
    // authorisation — it asks whether *this* caller received *this* listing.
    const payload = authenticate(request);
```

Update the imports: drop `orderItems` and `inArray` and `PURCHASED_ORDER_STATUSES`; drop `authorize` if nothing else in the file uses it.

Then delete the module and its test:

```bash
git rm src/lib/review-eligibility.ts src/lib/review-eligibility.test.ts
```

- [ ] **Step 9: Run everything**

Run: `npm run test:unit -- src/lib/listing-visibility.test.ts`
Expected: PASS.

Run: `npm run test:integration -- "src/app/api/listings/[id]/reserved.integration.test.ts" src/app/api/recommendations/route.integration.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit` — expected clean. `npm run lint` — expected clean; an unused import left behind by the deletions is the likely finding.

Run: `npm test`
Expected: PASS. Foreground, no background flag, no polling.

- [ ] **Step 10: Prove the reserved guard can fail**

Delete the `listing.status === "reserved"` condition from the `PUT` guard, leaving `if (status !== undefined && !isAdmin(payload))`.

Run: `npm run test:integration -- "src/app/api/listings/[id]/reserved.integration.test.ts" -t "leaves an active listing's status editable"`
Expected: FAIL — 409 on an active listing.

Restore it, then delete the guard entirely.

Run: the same file, `-t "refuses the seller's status change"`
Expected: FAIL — 200, and the listing is `removed` while a buyer holds it.

Restore and re-run the file; expected PASS.

- [ ] **Step 11: Commit**

```bash
git add -A src/lib/listing-visibility.ts src/lib/listing-visibility.test.ts \
  "src/app/api/listings/[id]/route.ts" "src/app/api/listings/[id]/reserved.integration.test.ts" \
  "src/app/api/images/[id]/route.ts" src/app/api/recommendations/route.ts \
  src/app/api/recommendations/route.integration.test.ts \
  "src/app/api/listings/[id]/reviews/route.ts" \
  src/lib/review-eligibility.ts src/lib/review-eligibility.test.ts
git commit -m "feat(orders): reserved listings, and one rule for review eligibility"
```

---

### Task 9: Drop the join table

Nothing reads `order_items` any more. This is the irreversible half, and it runs last among the code tasks for exactly that reason.

**Before writing anything, prove the claim.** Run:

```bash
grep -rn "orderItems\|order_items" src/ drizzle/ scripts/
```

Every hit must be in `drizzle/0000_initial_schema.sql`, `drizzle/meta/`, `drizzle/0015_orders_collapse.sql`, or one of the files this task is about to edit. A hit anywhere else means a consumer was missed and this task stops until it is moved. Do not proceed on the assumption that the earlier tasks were complete — that assumption is what the `listingImageUrl` miss in Part 2 was made of, and a case-blind grep is how it survived.

**Files:**
- Create: `drizzle/0016_drop_order_items.sql`
- Delete: `src/db/schema/order-items.ts`
- Modify: `src/db/schema/index.ts`, `src/db/schema/orders.ts`, `src/test/factories.ts`, `src/test/harness/factories.integration.test.ts`, `src/test/harness/test-db.integration.test.ts`, `src/app/api/recommendations/route.integration.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `orderItems`, `OrderItem` and `NewOrderItem` no longer exist; `orders.total_price` no longer exists.

- [ ] **Step 1: Write the migration**

Create `drizzle/0016_drop_order_items.sql`:

```sql
-- Part 3 of the 2026-08-30 redesign — remove the join table.
--
-- IRREVERSIBLE. 0015 copied every line into an order of its own, so nothing here is lost
-- that 0015 did not already preserve; but the table itself cannot come back, and a
-- database that has run this cannot run the old code.
--
-- Deliberately separate from 0015 (spec §8): every consumer of `order_items` had to move
-- to `orders.listing_id` first, and dropping it in the additive migration would have left
-- the tree broken between tasks.

DROP TABLE IF EXISTS "order_items";
--> statement-breakpoint
-- With one listing per order, the price is the total. `total_price` has been nullable and
-- unwritten since 0015.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "total_price";
```

- [ ] **Step 2: Update the migration replay test**

`src/db/schema/orders-collapse.integration.test.ts` stops applying after 0015, so it is unaffected — but its last describe now claims something the *final* schema contradicts. Rename it so the claim stays true:

```ts
describe("0015 — what it deliberately leaves for 0016", () => {
```

and leave both cases as they are: they assert what 0015 does, on a database that has only run up to 0015, which is exactly the point.

- [ ] **Step 3: Delete the schema module**

```bash
git rm src/db/schema/order-items.ts
```

In `src/db/schema/index.ts`: remove the `orderItems` import, the `export * from "./order-items";` line, the `orderItems: many(orderItems)` entries from `listingsRelations` and `ordersRelations`, and the whole `orderItemsRelations` block.

`listingsRelations` gains the relation that replaces it:

```ts
export const listingsRelations = relations(listings, ({ one, many }) => ({
  seller: one(users, {
    fields: [listings.sellerId],
    references: [users.id],
  }),
  category: one(categories, {
    fields: [listings.categoryId],
    references: [categories.id],
  }),
  orders: many(orders),
  reviews: many(reviews),
}));
```

- [ ] **Step 4: Stop the factory writing to it**

In `src/test/factories.ts`, delete the `await db.insert(orderItems).values({...})` block at the end of `makeOrder` along with the comment above it, remove `orderItems` from the schema import, and drop the `totalPrice` line from the values object.

In `src/db/schema/orders.ts`, delete the `totalPrice` column and the comment above it. Nothing reads it any more, and the column is gone as of 0016.

In `src/app/api/recommendations/route.integration.test.ts`, drop `totalPrice: "10.00"` from the direct `orders` insert.

- [ ] **Step 5: Update the harness tests**

In `src/test/harness/factories.integration.test.ts`, replace the two `makeOrder` cases:

```ts
  it("AC5: makeOrder creates a buyer, a listing and the order between them", async () => {
    const order = await makeOrder();
    const db = await getTestDb();

    expect(order.id).toEqual(expect.any(Number));
    expect(order.listingId).toEqual(expect.any(Number));

    // The seller is captured from the listing, which is what a real order does — the
    // recommendations query and the seller dashboard both read it off the order.
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, order.listingId));
    expect(order.sellerId).toBe(listing.sellerId);

    const [buyer] = await db.select().from(users).where(eq(users.id, order.buyerId));
    expect(buyer).toBeDefined();
  });

  it("AC5: makeOrder accepts an explicit listing, and prices the order from it", async () => {
    const listing = await makeListing({ price: "42.50" });
    const order = await makeOrder({ listingId: listing.id });

    expect(order.listingId).toBe(listing.id);
    expect(order.price).toBe("42.50");
  });

  it("AC5: makeOrder gives the order a deadline, so it is not swept immediately", async () => {
    const order = await makeOrder();
    expect(order.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
```

and remove `orderItems` from that file's schema import and from the truncation loop's table list (the loop becomes `[users, categories, listings, orders, reviews]`).

In `src/test/harness/test-db.integration.test.ts`, remove `"order_items"` from the list of tables the factories write to.

- [ ] **Step 6: Update the last direct insert**

In `src/app/api/recommendations/route.integration.test.ts`, delete the `await db.insert(orderItems).values({...})` that follows the direct `orders` insert in the recency test, and remove `orderItems` from that file's schema import. The order row already carries `listingId`, so the join the test exercises is satisfied by the insert above it.

- [ ] **Step 7: Run everything**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean.

Run: `npm test`
Expected: PASS, the whole suite. Foreground, no background flag, no monitor, no sleep-polling — wait inside the call. Six to eight minutes is normal.

The integration project applies every migration to a fresh database at the start of the run, so a green suite here is also the evidence that 0016 applies cleanly on top of 0015.

- [ ] **Step 8: Prove the drop actually happened**

```bash
grep -rn "order_items" src/
```

Expected: no hits at all.

- [ ] **Step 9: Commit**

```bash
git add -A drizzle/0016_drop_order_items.sql src/db/schema/order-items.ts src/db/schema/index.ts \
  src/db/schema/orders.ts src/db/schema/orders-collapse.integration.test.ts src/test/factories.ts \
  src/test/harness/factories.integration.test.ts src/test/harness/test-db.integration.test.ts \
  src/app/api/recommendations/route.integration.test.ts
git commit -m "feat(orders): drop order_items and total_price

Irreversible. 0015 preserved every line as an order of its own first."
```

---

### Task 10: The documents that describe all this

The security documents are tested (`src/test/threat-model.test.ts`), so getting them wrong is a test failure rather than a stale paragraph. Read that test before editing either file.

**Files:**
- Modify: `docs/security/rbac-matrix.md`, `docs/security/threat-model.md`
- Modify: `scripts/generate-swagger.mjs`
- Modify: `README.md`
- Regenerate: `src/lib/swagger-spec.json`

- [ ] **Step 1: Update the RBAC matrix**

In `docs/security/rbac-matrix.md`, replace the five order rows and amend three others. The columns are `Route | Method | Auth | Buyer | Seller | Admin | Notes`.

```markdown
| `/api/orders` | GET | required | own | own | all | The caller's purchases, whatever their role — `buyerId = caller` |
| `/api/orders` | POST | required | ✓ | ✓ | ✓ | Anyone signed in may buy (D5); `buyerId` from the token; the listing's own seller gets **403** |
| `/api/orders/{id}` | GET | required | party | party | ✓ | `canViewOrder` — buyer or seller of *this* order; refusal is **404** |
| `/api/orders/{id}` | PUT | required | party | party | ✓ | `canTransition(from, to, actor)`; a non-party gets **404**, an illegal transition **400** |
| `/api/orders/{id}` | DELETE | required | ✗ | ✗ | ✓ | Releases the listing in the same transaction |
| `/api/orders/seller` | GET | required | ✗ | own sales | ✓ | Scoped to `orders.sellerId` |
```

Amend:

```markdown
| `/api/listings/{id}` | PUT · DELETE | required | ✗ | owner | ✓ | `canMutateListing`; a **409** on any status change while the listing is `reserved` |
| `/api/images/{id}` | GET | optional | ✓ | ✓ | ✓ | Public for a published listing (`active`/`reserved`/`sold`); owner or admin otherwise → **404**, not 403 (see below) |
| `/api/listings/{id}/reviews` | POST | required | ✓ | ✓ | ✓ | Must be the buyer on a `completed` order for this listing |
```

The `Known gaps` section gains one line, since Part 3 introduces it:

```markdown
- **`DELETE /api/users/{id}`** now also cascades to orders on both sides — a deleted
  seller takes their buyers' purchase records with them. Same disposition as the listing
  cascade above: intended, destructive, no soft delete, deferred.
```

**Two sentences in this file are asserted by `src/test/threat-model.test.ts` and must survive your edit**, in whatever wording you choose: one matching `/404 replaces 403|404 over 403/` and one matching `/before it checks whether|decided before state/`. The second currently reads:

> `PUT /api/orders/{id}` checks ownership *before* it checks whether the order is still `pending`.

Update it to describe the new behaviour while keeping the phrase intact — for example: "`PUT /api/orders/{id}` decides whether the caller is a party to the order before it checks whether the transition they asked for is legal. The other order returns `400 "Cannot move an order from completed to confirmed"` to a stranger, which is a fact about someone else's purchase."

- [ ] **Step 2: Update the threat model**

In `docs/security/threat-model.md`, section `T9 — Information disclosure through error behaviour`, replace the two order bullets:

```markdown
- `GET /api/orders/{id}` answers **404** for an order the caller is not a party to,
  byte-identical to the genuinely-missing case. A 403 on a sequential id is an
  enumeration oracle.
- `PUT /api/orders/{id}` answers **404** to a non-party too, and settles that question
  *before* it looks at the order's status. Either mistake leaks: a 403 says the order
  exists, and "Cannot move an order from `completed` to `confirmed`" says what state
  someone else's purchase is in.
```

Leave the `**Proof.**` line's cited test file names unchanged unless a name actually moved — the test asserts every cited `*.test.ts` exists. The quoted case name "checks ownership before order state, so a stranger cannot read the status" still exists in `rbac.integration.test.ts` after Task 5, which kept it deliberately.

The asset table's `Order and review data` row stays as it is. Do not add a threat: the test asserts exactly ten, each with one `**Mitigations.**` and one `**Proof.**`.

- [ ] **Step 3: Update the Swagger definitions**

In `scripts/generate-swagger.mjs`, replace the `Order` schema and delete `OrderItem` entirely:

```js
      Order: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          buyerId: { type: "integer", example: 3 },
          sellerId: { type: "integer", example: 7 },
          listingId: { type: "integer", example: 5 },
          price: { type: "string", example: "999.99" },
          status: {
            type: "string",
            enum: ["pending", "confirmed", "shipped", "completed", "cancelled", "declined", "expired"],
            example: "pending",
          },
          expiresAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
```

Beware the generator's one sharp edge, which has produced four broken specs across two epics: an unquoted comma inside a jsdoc `description` truncates the YAML string and leaves a null-valued key, and the generator still exits 0. Every multi-line `description:` you touched in Tasks 4, 5, 6 and 8 uses the `|` block form, which is safe. Any single-line description containing a comma or a colon must be quoted.

- [ ] **Step 4: Regenerate and check the spec**

Run: `node scripts/generate-swagger.mjs`

Then confirm the output is actually valid, rather than trusting the exit code:

```bash
node -e "const s=require('./src/lib/swagger-spec.json'); const bad=JSON.stringify(s).match(/:null/g); console.log('null values:', bad ? bad.length : 0); console.log('order paths:', Object.keys(s.paths).filter(p=>p.includes('order')));"
```

Expected: `null values: 0`, and the four order paths present. A non-zero null count means a description broke the YAML — find it and quote it.

- [ ] **Step 5: Update the README**

Add the sweep beside the other database commands, wherever `db:prune-tokens` is documented:

```markdown
| `npm run db:expire-reservations` | Return listings held by lapsed reservations to browse. Safe to run repeatedly; a cron entry every ten minutes is ample for a 48-hour deadline. Correctness does not depend on it — placing an order expires whatever is holding that listing first. |
```

If the README documents the order flow or the status values anywhere, bring that text in line with the graph: `pending → confirmed → shipped → completed`, with `declined`, `cancelled` and `expired` as the ways it ends early. Search for `approved` and `rejected` before deciding there is nothing to change.

- [ ] **Step 6: Run everything**

Run: `npm run test:unit -- src/test/threat-model.test.ts`
Expected: PASS. This is the test that fails when a security document stops being true.

Run: `npm test`
Expected: PASS, the whole suite.

Run: `npx tsc --noEmit` and `npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add docs/security/rbac-matrix.md docs/security/threat-model.md \
  scripts/generate-swagger.mjs src/lib/swagger-spec.json README.md
git commit -m "docs(orders): rbac matrix, threat model and API spec follow the lifecycle"
```

---

## Done when

- `orders` holds one listing, its seller, its price and its deadline; `order_items` and `total_price` no longer exist.
- Two simultaneous buyers of one listing produce exactly one 201 and one 409, and one order row.
- A seller cannot buy their own listing, and can buy anyone else's.
- Every transition in §5.3 is reachable by exactly the parties named, and no transition leaves a terminal state.
- Confirming an order sells the listing; declining, cancelling or expiring returns it to browse — in the same transaction as the status change.
- A reservation lapses after 48 hours whether or not the sweep ever runs, and `npm run db:expire-reservations` returns lapsed listings to browse promptly.
- Only a `completed` order unlocks a review; `src/lib/review-eligibility.ts` is gone.
- A `reserved` or `sold` listing is publicly readable and its photos are served; a `draft` or `removed` one is not.
- A seller cannot change the status of a listing a buyer is holding.
- The RBAC matrix, the threat model and the Swagger spec describe what the code does, and `threat-model.test.ts` passes.
- `npm test` is green: `npx tsc --noEmit` and `npm run lint` are clean.
