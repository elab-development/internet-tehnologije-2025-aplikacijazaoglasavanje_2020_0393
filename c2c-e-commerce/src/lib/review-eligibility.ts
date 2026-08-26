import type { orderStatusEnum } from "@/db/schema";

type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

// ─── Review eligibility ───────────────────────────────────────────────────────
// A marketplace review is only worth anything if the reviewer actually bought
// the thing. Without this, any buyer account can rate any listing, which is the
// standard way fake-review rings work.

/**
 * Order statuses that count as "this purchase really happened".
 *
 * - `pending`   — the seller has not accepted the order yet, so nothing was bought.
 * - `approved`  — the seller accepted it; this app also marks the listing sold here.
 * - `paid` / `shipped` / `completed` — unambiguously purchased.
 * - `cancelled` / `rejected` — the sale fell through.
 */
export const PURCHASED_ORDER_STATUSES = [
  "paid",
  "shipped",
  "completed",
  "approved",
] as const satisfies readonly OrderStatus[];

/** Whether an order in this state entitles its buyer to review its listings. */
export function isPurchasedStatus(status: OrderStatus): boolean {
  return (PURCHASED_ORDER_STATUSES as readonly string[]).includes(status);
}
