"use client";

import { useRouter } from "next/navigation";
import { RiShoppingBagLine } from "@remixicon/react";
import CurrencySelect from "@/components/CurrencySelect";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  OrderCardSkeleton,
  StatusBadge,
} from "@/components/ui";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
import { useFetch } from "@/hooks/useFetch";
import type { OrdersResponse } from "@/types/api";

function OrdersPageContent() {
  const router = useRouter();
  const { data, loading, error } = useFetch<OrdersResponse>("/api/orders");
  const orders = data?.data ?? [];

  const conversion = useCurrencyConversion();
  const { formatConverted } = conversion;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold text-zinc-900">My Orders</h1>
        <CurrencySelect conversion={conversion} className="sm:w-48" />
      </div>

      {error && <ErrorAlert message={error} />}

      {loading ? (
        <div className="grid gap-4" aria-label="Loading orders">
          {Array.from({ length: 4 }).map((_, i) => (
            <OrderCardSkeleton key={i} />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<RiShoppingBagLine size={32} />}
          title="No orders yet"
          description="Browse listings and place your first order to get started."
          action={
            <Button onClick={() => router.push("/listings")}>
              Browse listings
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {orders.map((order) => (
            <Card
              key={order.id}
              title={`Order #${order.id}`}
              description={`Placed on ${new Date(order.createdAt).toLocaleString()}`}
              footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-zinc-900">
                      ${Number(order.price).toFixed(2)}
                    </span>
                    <span className="text-zinc-500">
                      ({formatConverted(Number(order.price))})
                    </span>
                    <StatusBadge status={order.status} descriptive />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => router.push(`/orders/${order.id}`)}
                  >
                    Details
                  </Button>
                </div>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <ProtectedRoute>
      <OrdersPageContent />
    </ProtectedRoute>
  );
}
