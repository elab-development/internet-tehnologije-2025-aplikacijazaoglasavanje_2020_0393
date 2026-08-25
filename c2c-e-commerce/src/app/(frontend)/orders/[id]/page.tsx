"use client";

import { useParams, useRouter } from "next/navigation";
import CurrencySelect from "@/components/CurrencySelect";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  Button,
  Card,
  ErrorAlert,
  Skeleton,
  StatusBadge,
} from "@/components/ui";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
import { useFetch } from "@/hooks/useFetch";
import type { OrderDetail } from "@/types/api";

function OrderDetailSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/5" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </div>
    </div>
  );
}

function OrderDetailPageContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const idNum = Number(params.id);
  const hasValidId = Number.isInteger(idNum) && idNum > 0;

  const {
    data: order,
    loading,
    error,
  } = useFetch<OrderDetail>(hasValidId ? `/api/orders/${idNum}` : null);

  const conversion = useCurrencyConversion();
  const { formatConverted } = conversion;

  if (!hasValidId || (!loading && (error || !order))) {
    return (
      <div className="space-y-4">
        <ErrorAlert
          message={
            !hasValidId ? "Invalid order id" : (error ?? "Order not found")
          }
        />
        <Button variant="secondary" onClick={() => router.push("/orders")}>
          Back to orders
        </Button>
      </div>
    );
  }

  if (loading || !order) return <OrderDetailSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-zinc-900">Order #{order.id}</h1>
        <StatusBadge status={order.status} descriptive size="md" />
      </div>

      <div className="grid gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        <p>
          <span className="font-medium text-zinc-900">Date:</span>{" "}
          {new Date(order.createdAt).toLocaleString()}
        </p>
        <p>
          <span className="font-medium text-zinc-900">Total:</span> $
          {Number(order.totalPrice).toFixed(2)}
        </p>
        <p>
          <span className="font-medium text-zinc-900">Converted total:</span>{" "}
          {formatConverted(Number(order.totalPrice))}
        </p>
      </div>

      <CurrencySelect conversion={conversion} className="sm:max-w-xs" />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-900">Order Items</h2>

        {order.items.length === 0 ? (
          <p className="text-sm text-zinc-500">No items found for this order.</p>
        ) : (
          <div className="grid gap-3">
            {order.items.map((item) => {
              const lineTotal = Number(item.price) * item.quantity;
              return (
                <Card
                  key={item.id}
                  title={item.listingTitle}
                  description={`Quantity: ${item.quantity}`}
                  footer={
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-semibold text-zinc-900">
                        ${lineTotal.toFixed(2)}
                      </span>
                      <span className="text-zinc-500">
                        {formatConverted(lineTotal)}
                      </span>
                    </div>
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <Button variant="secondary" onClick={() => router.push("/orders")}>
        Back to orders
      </Button>
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <ProtectedRoute>
      <OrderDetailPageContent />
    </ProtectedRoute>
  );
}
