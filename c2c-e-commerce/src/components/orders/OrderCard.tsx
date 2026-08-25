"use client";

import { RiCheckLine, RiCloseLine } from "@remixicon/react";
import { Button, StatusBadge } from "@/components/ui";
import type { SellerOrder } from "@/types/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderCardProps = {
  order: SellerOrder;
  formatConverted: (amount: number) => string;
  /** Show the approve/reject controls. Only meaningful for pending orders. */
  showActions?: boolean;
  updating?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * A seller-facing order card: buyer details, the seller's own lines from the
 * order, and (for pending orders) the approve/reject controls.
 */
export default function OrderCard({
  order,
  formatConverted,
  showActions = false,
  updating = false,
  onApprove,
  onReject,
}: OrderCardProps) {
  // Only this seller's lines are returned, so the order total and the amount
  // this seller is owed are not the same number.
  const sellerTotal = order.items.reduce(
    (sum, item) => sum + Number(item.price) * item.quantity,
    0,
  );

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            Order #{order.id}
          </h3>
          <p className="text-xs text-zinc-500">
            {new Date(order.createdAt).toLocaleString()} · Buyer:{" "}
            <span className="font-medium text-zinc-700">{order.buyerName}</span>{" "}
            ({order.buyerEmail})
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* Items */}
      <div className="divide-y divide-zinc-50 px-4">
        {order.items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-800 truncate">
                {item.listingTitle}
              </p>
              <p className="text-xs text-zinc-500">Qty: {item.quantity}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-zinc-900">
                ${(Number(item.price) * item.quantity).toFixed(2)}
              </p>
              <p className="text-xs text-zinc-500">
                {formatConverted(Number(item.price) * item.quantity)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3 bg-zinc-50/50">
        <div className="text-sm">
          <span className="text-zinc-500">Your items total: </span>
          <span className="font-semibold text-zinc-900">
            ${sellerTotal.toFixed(2)}
          </span>
          <span className="text-zinc-500 ml-1">
            ({formatConverted(sellerTotal)})
          </span>
        </div>

        {showActions && (
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<RiCheckLine size={16} />}
              loading={updating}
              onClick={onApprove}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<RiCloseLine size={16} />}
              loading={updating}
              onClick={onReject}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
