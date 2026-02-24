"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
import { api } from "@/lib/api";

type OrderItem = {
  id: number;
  listingId: number;
  listingTitle: string;
  quantity: number;
  price: string;
};

type OrderDetail = {
  id: number;
  totalPrice: string;
  status: "pending" | "paid" | "shipped" | "completed" | "cancelled";
  createdAt: string;
  items: OrderItem[];
};

const statusClasses: Record<OrderDetail["status"], string> = {
  pending: "bg-amber-100 text-amber-700",
  paid: "bg-blue-100 text-blue-700",
  shipped: "bg-indigo-100 text-indigo-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

function OrderDetailPageContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    selectedCurrency,
    setSelectedCurrency,
    loadingRates,
    ratesError,
    availableCurrencies,
    formatConverted,
  } = useCurrencyConversion();

  useEffect(() => {
    let alive = true;

    async function loadOrder() {
      const idNum = Number(params.id);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        setError("Invalid order id");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const data = await api.get<OrderDetail>(`/api/orders/${idNum}`);
        if (!alive) return;
        setOrder(data);
      } catch (err: unknown) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load order");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadOrder();

    return () => {
      alive = false;
    };
  }, [params.id]);

  if (loading) {
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

  if (error || !order) {
    return (
      <div className="space-y-4">
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="shrink-0 mt-0.5">⚠️</span>
          <span>{error ?? "Order not found"}</span>
        </div>
        <Button variant="secondary" onClick={() => router.push("/orders")}>Back to orders</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-zinc-900">Order #{order.id}</h1>
        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold",
            statusClasses[order.status],
          ].join(" ")}
        >
          {order.status}
        </span>
      </div>

      <div className="grid gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        <p>
          <span className="font-medium text-zinc-900">Date:</span> {new Date(order.createdAt).toLocaleString()}
        </p>
        <p>
          <span className="font-medium text-zinc-900">Total:</span> ${Number(order.totalPrice).toFixed(2)}
        </p>
        <p>
          <span className="font-medium text-zinc-900">Converted total:</span> {formatConverted(Number(order.totalPrice))}
        </p>
      </div>

      <div className="flex flex-col gap-1 sm:max-w-xs">
        <label className="text-sm font-medium text-zinc-700" htmlFor="order-detail-currency">
          Convert price
        </label>
        <select
          id="order-detail-currency"
          value={selectedCurrency}
          onChange={(event) => setSelectedCurrency(event.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          disabled={loadingRates}
        >
          {availableCurrencies.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
        {ratesError && <p className="text-xs text-red-500">{ratesError}</p>}
      </div>

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
                      <span className="text-zinc-500">{formatConverted(lineTotal)}</span>
                    </div>
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <Button variant="secondary" onClick={() => router.push("/orders")}>Back to orders</Button>
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
