"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import CurrencySelect from "@/components/CurrencySelect";
import OrderActions from "@/components/orders/OrderActions";
import ProtectedRoute from "@/components/ProtectedRoute";
import ReviewForm from "@/components/reviews/ReviewForm";
import {
  Button,
  ErrorAlert,
  Skeleton,
  StatusBadge,
} from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
import { useFetch } from "@/hooks/useFetch";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import type { OrderActor, OrderStatus } from "@/lib/order-lifecycle";
import type { Order, OrderDetail } from "@/types/api";

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
      {/* One row of controls, not a list of lines: an order is one listing now. */}
      <div className="flex gap-2">
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
    </div>
  );
}

function OrderDetailPageContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user } = useAuth();

  const idNum = Number(params.id);
  const hasValidId = Number.isInteger(idNum) && idNum > 0;

  const {
    data: order,
    setData,
    loading,
    error,
    refetch,
  } = useFetch<OrderDetail>(hasValidId ? `/api/orders/${idNum}` : null);

  const conversion = useCurrencyConversion();
  const { formatConverted } = conversion;

  // The viewer's relationship to this order, which is what decides the controls — a
  // seller may be the buyer on someone else's sale, so the role alone answers nothing.
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
          <span className="font-medium text-zinc-900">Price:</span> {formatPrice(order.price)}{" "}
          <span className="text-zinc-500">({formatConverted(Number(order.price))})</span>
        </p>
        {order.status === "pending" && (
          <p>
            <span className="font-medium text-zinc-900">Reservation expires:</span>{" "}
            {new Date(order.expiresAt).toLocaleString()}
          </p>
        )}
      </div>

      <CurrencySelect conversion={conversion} className="sm:max-w-xs" />

      {actor && (
        <OrderActions
          status={order.status}
          actor={actor}
          busy={pendingStatus !== null}
          onTransition={handleTransition}
        />
      )}

      {/* Three conditions, all of them the server's rules restated: completed, this
          viewer's own purchase, and not already reviewed. Getting any of them wrong here
          produces a 403 or a 409 rather than a bad write — the endpoint decides. */}
      {actor === "buyer" && order.status === "completed" && order.reviewId === null && (
        <ReviewForm orderId={order.id} onSubmitted={refetch} />
      )}

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
