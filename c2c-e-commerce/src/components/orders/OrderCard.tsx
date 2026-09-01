"use client";

import Image from "next/image";

import OrderActions from "@/components/orders/OrderActions";
import { StatusBadge } from "@/components/ui";
import { formatPrice } from "@/lib/format";
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
            {formatPrice(price)} ({formatConverted(price)})
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
