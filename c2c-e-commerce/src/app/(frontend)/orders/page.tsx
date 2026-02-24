"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { RiShoppingBagLine } from "@remixicon/react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ProtectedRoute from "@/components/ProtectedRoute";
import { OrderCardSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";

type Order = {
  id: number;
  totalPrice: string;
  status: "pending" | "paid" | "shipped" | "completed" | "cancelled" | "approved" | "rejected";
  createdAt: string;
};

const statusClasses: Record<Order["status"], string> = {
  pending: "bg-amber-100 text-amber-700",
  paid: "bg-blue-100 text-blue-700",
  shipped: "bg-indigo-100 text-indigo-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const statusLabels: Record<Order["status"], string> = {
  pending: "Awaiting seller approval",
  paid: "Paid",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
  approved: "Approved by seller",
  rejected: "Rejected by seller",
};

function OrdersPageContent() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
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

    async function loadOrders() {
      try {
        setLoading(true);
        setError(null);
        const data = await api.get<Order[]>("/api/orders");
        if (!alive) return;
        setOrders(data);
      } catch (err: unknown) {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : "Failed to load orders";
        setError(msg);
        toast.error(msg);
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadOrders();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold text-zinc-900">My Orders</h1>

        <div className="flex flex-col gap-1 sm:w-48">
          <label className="text-sm font-medium text-zinc-700" htmlFor="orders-currency">
            Convert price
          </label>
          <select
            id="orders-currency"
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
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="shrink-0 mt-0.5">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4" aria-label="Loading orders">
          {Array.from({ length: 4 }).map((_, i) => (
            <OrderCardSkeleton key={i} />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
            <RiShoppingBagLine size={32} />
          </span>
          <p className="text-lg font-semibold text-zinc-700">No orders yet</p>
          <p className="text-sm text-zinc-500 max-w-xs">Browse listings and place your first order to get started.</p>
          <Button onClick={() => router.push("/listings")}>Browse listings</Button>
        </div>
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
                      ${Number(order.totalPrice).toFixed(2)}
                    </span>
                    <span className="text-zinc-500">({formatConverted(Number(order.totalPrice))})</span>
                    <span
                      className={[
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        statusClasses[order.status],
                      ].join(" ")}
                    >
                      {statusLabels[order.status]}
                    </span>
                  </div>
                  <Button size="sm" onClick={() => router.push(`/orders/${order.id}`)}>
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
