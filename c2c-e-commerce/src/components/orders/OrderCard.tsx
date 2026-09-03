"use client";

import Image from "next/image";

import OrderActions from "@/components/orders/OrderActions";
import { StatusBadge } from "@/components/ui";
import { formatDate, formatPrice } from "@/lib/format";
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
    <div className="overflow-hidden border border-rule bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-[1.5px] border-ink bg-inset px-4 py-3">
        <div>
          <h3 className="eyebrow text-ink">Order #{order.id}</h3>
          <p className="mt-1 text-xs text-ink-3">
            {formatDate(order.createdAt)} · Buyer:{" "}
            <span className="font-semibold text-ink-2">{order.buyerName}</span>{" "}
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
            className="h-14 w-14 rounded-none object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink">
            {order.listingTitle}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            <span className="figure text-base text-ink">{formatPrice(price)}</span>{" "}
            ({formatConverted(price)})
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-rule px-4 py-3">
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
