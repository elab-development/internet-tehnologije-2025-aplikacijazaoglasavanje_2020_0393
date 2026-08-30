"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { RiShoppingBagLine } from "@remixicon/react";
import OrderCard from "@/components/orders/OrderCard";
import { EmptyState, ErrorAlert, OrderCardSkeleton } from "@/components/ui";
import type { UseFetchResult } from "@/hooks/useFetch";
import { api } from "@/lib/api";
import type { OrderStatus } from "@/lib/order-lifecycle";
import type { SellerOrder } from "@/types/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SellerOrdersTabProps = {
  /**
   * Owned by the page rather than this tab: the tab strip shows the pending
   * count even while the listings tab is the one on screen.
   */
  orders: UseFetchResult<SellerOrder[]>;
  formatConverted: (amount: number) => string;
};

// ─── Component ────────────────────────────────────────────────────────────────

/** The "Incoming Orders" tab of the seller dashboard. */
export default function SellerOrdersTab({
  orders: ordersFetch,
  formatConverted,
}: SellerOrdersTabProps) {
  const { data, setData, loading, error } = ordersFetch;
  const orders = data ?? [];

  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);

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

  const pendingOrders = orders.filter((order) => order.status === "pending");
  const processedOrders = orders.filter((order) => order.status !== "pending");

  return (
    <div className="space-y-6">
      {error && <ErrorAlert message={error} />}

      {loading ? (
        <div className="grid gap-4" aria-label="Loading orders">
          {Array.from({ length: 3 }).map((_, i) => (
            <OrderCardSkeleton key={i} />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<RiShoppingBagLine size={32} />}
          title="No orders yet"
          description="When buyers purchase your listings, orders will appear here."
        />
      ) : (
        <>
          {pendingOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-zinc-900">
                Pending Approval ({pendingOrders.length})
              </h2>
              <div className="grid gap-4">
                {pendingOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    formatConverted={formatConverted}
                    updating={updatingOrderId === order.id}
                    onTransition={(to) => handleTransition(order.id, to)}
                  />
                ))}
              </div>
            </section>
          )}

          {processedOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-zinc-900">
                Other Orders ({processedOrders.length})
              </h2>
              <div className="grid gap-4">
                {processedOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    formatConverted={formatConverted}
                    updating={updatingOrderId === order.id}
                    onTransition={(to) => handleTransition(order.id, to)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
