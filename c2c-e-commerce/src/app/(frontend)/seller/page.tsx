"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  RiStoreLine,
  RiCheckLine,
  RiCloseLine,
  RiShoppingBagLine,
  RiEyeLine,
  RiEyeOffLine,
} from "@remixicon/react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import ProtectedRoute from "@/components/ProtectedRoute";
import { OrderCardSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";

// ─── Types ────────────────────────────────────────────────────────────────────

type SellerOrderItem = {
  id: number;
  listingId: number;
  listingTitle: string;
  listingImageUrl: string | null;
  quantity: number;
  price: string;
};

type SellerOrder = {
  id: number;
  buyerId: number;
  buyerName: string;
  buyerEmail: string;
  totalPrice: string;
  status: string;
  createdAt: string;
  items: SellerOrderItem[];
};

type SellerListing = {
  id: number;
  title: string;
  description: string;
  price: string;
  status: string;
  imageUrl: string | null;
};

type ListingsResponse = {
  data: SellerListing[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const statusClasses: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  paid: "bg-blue-100 text-blue-700",
  shipped: "bg-indigo-100 text-indigo-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "listings" | "orders";

// ─── Content component ───────────────────────────────────────────────────────

function SellerDashboardContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("orders");

  // ── Orders state ──
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);

  // ── Listings state ──
  const [listings, setListings] = useState<SellerListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [updatingListingId, setUpdatingListingId] = useState<number | null>(null);

  const {
    selectedCurrency,
    setSelectedCurrency,
    loadingRates,
    ratesError,
    availableCurrencies,
    formatConverted,
  } = useCurrencyConversion();

  // ── Load seller orders ──
  useEffect(() => {
    let alive = true;

    async function loadOrders() {
      try {
        setOrdersLoading(true);
        setOrdersError(null);
        const data = await api.get<SellerOrder[]>("/api/orders/seller");
        if (!alive) return;
        setOrders(data);
      } catch (err: unknown) {
        if (!alive) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load orders";
        setOrdersError(msg);
        toast.error(msg);
      } finally {
        if (alive) setOrdersLoading(false);
      }
    }

    loadOrders();
    return () => {
      alive = false;
    };
  }, []);

  // ── Load seller listings ──
  useEffect(() => {
    let alive = true;

    async function loadListings() {
      if (!user) return;
      try {
        setListingsLoading(true);
        setListingsError(null);
        const data = await api.get<ListingsResponse>(
          `/api/listings?sellerId=${user.id}&limit=100`
        );
        if (!alive) return;
        setListings(data.data);
      } catch (err: unknown) {
        if (!alive) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load listings";
        setListingsError(msg);
        toast.error(msg);
      } finally {
        if (alive) setListingsLoading(false);
      }
    }

    loadListings();
    return () => {
      alive = false;
    };
  }, [user]);

  // ── Approve / Reject handler ──
  async function handleStatusUpdate(
    orderId: number,
    newStatus: "approved" | "rejected"
  ) {
    try {
      setUpdatingOrderId(orderId);
      await api.put(`/api/orders/${orderId}`, { status: newStatus });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );

      // When approving, mark the order's listings as sold in local state
      if (newStatus === "approved") {
        const order = orders.find((o) => o.id === orderId);
        if (order) {
          const soldIds = new Set(order.items.map((i) => i.listingId));
          setListings((prev) =>
            prev.map((l) =>
              soldIds.has(l.id) ? { ...l, status: "sold" } : l
            )
          );
        }
      }

      toast.success(
        `Order #${orderId} ${newStatus === "approved" ? "approved" : "rejected"}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update order";
      toast.error(msg);
    } finally {
      setUpdatingOrderId(null);
    }
  }

  // ── Toggle listing status handler ──
  async function handleListingStatusToggle(
    listingId: number,
    currentStatus: string
  ) {
    const newStatus = currentStatus === "active" ? "removed" : "active";
    try {
      setUpdatingListingId(listingId);
      await api.put(`/api/listings/${listingId}`, { status: newStatus });
      setListings((prev) =>
        prev.map((l) =>
          l.id === listingId ? { ...l, status: newStatus } : l
        )
      );
      toast.success(
        `Listing ${newStatus === "active" ? "activated" : "disabled"}`
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to update listing";
      toast.error(msg);
    } finally {
      setUpdatingListingId(null);
    }
  }

  const pendingOrders = orders.filter((o) => o.status === "pending");
  const processedOrders = orders.filter((o) => o.status !== "pending");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">
            Seller Dashboard
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage your listings and incoming orders
          </p>
        </div>

        <div className="flex flex-col gap-1 sm:w-48">
          <label
            className="text-sm font-medium text-zinc-700"
            htmlFor="seller-currency"
          >
            Convert price
          </label>
          <select
            id="seller-currency"
            value={selectedCurrency}
            onChange={(e) => setSelectedCurrency(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            disabled={loadingRates}
          >
            {availableCurrencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {ratesError && <p className="text-xs text-red-500">{ratesError}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-200">
        <button
          type="button"
          onClick={() => setTab("orders")}
          className={[
            "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
            tab === "orders"
              ? "border-indigo-600 text-indigo-700"
              : "border-transparent text-zinc-500 hover:text-zinc-700",
          ].join(" ")}
        >
          Incoming Orders
          {pendingOrders.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              {pendingOrders.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("listings")}
          className={[
            "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
            tab === "listings"
              ? "border-indigo-600 text-indigo-700"
              : "border-transparent text-zinc-500 hover:text-zinc-700",
          ].join(" ")}
        >
          My Listings
        </button>
      </div>

      {/* ─── Orders tab ─────────────────────────────────────────────── */}
      {tab === "orders" && (
        <div className="space-y-6">
          {ordersError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span>{ordersError}</span>
            </div>
          )}

          {ordersLoading ? (
            <div className="grid gap-4" aria-label="Loading orders">
              {Array.from({ length: 3 }).map((_, i) => (
                <OrderCardSkeleton key={i} />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-20 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
                <RiShoppingBagLine size={32} />
              </span>
              <p className="text-lg font-semibold text-zinc-700">
                No orders yet
              </p>
              <p className="text-sm text-zinc-500 max-w-xs">
                When buyers purchase your listings, orders will appear here.
              </p>
            </div>
          ) : (
            <>
              {/* Pending orders */}
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
                        onApprove={() =>
                          handleStatusUpdate(order.id, "approved")
                        }
                        onReject={() =>
                          handleStatusUpdate(order.id, "rejected")
                        }
                        updating={updatingOrderId === order.id}
                        showActions
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Processed orders */}
              {processedOrders.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold text-zinc-900">
                    Processed Orders ({processedOrders.length})
                  </h2>
                  <div className="grid gap-4">
                    {processedOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        formatConverted={formatConverted}
                        showActions={false}
                        updating={false}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Listings tab ───────────────────────────────────────────── */}
      {tab === "listings" && (
        <div className="space-y-4">
          {listingsError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span>{listingsError}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => router.push("/listings/new")}>
              + New Listing
            </Button>
          </div>

          {listingsLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-2xl bg-zinc-100"
                />
              ))}
            </div>
          ) : listings.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-20 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
                <RiStoreLine size={32} />
              </span>
              <p className="text-lg font-semibold text-zinc-700">
                No listings yet
              </p>
              <p className="text-sm text-zinc-500 max-w-xs">
                Create your first listing to start selling.
              </p>
              <Button onClick={() => router.push("/listings/new")}>
                Create Listing
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((listing) => {
                const listingStatusClasses: Record<string, string> = {
                  active: "bg-emerald-100 text-emerald-700",
                  sold: "bg-blue-100 text-blue-700",
                  removed: "bg-zinc-100 text-zinc-500",
                };
                const canToggle =
                  listing.status === "active" || listing.status === "removed";
                return (
                  <Card
                    key={listing.id}
                    image={listing.imageUrl}
                    title={listing.title}
                    badge={listing.status}
                    description={
                      listing.description.length > 80
                        ? listing.description.slice(0, 80) + "…"
                        : listing.description
                    }
                    onClick={() => router.push(`/listings/${listing.id}`)}
                    footer={
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-zinc-900">
                              ${Number(listing.price).toFixed(2)}
                            </span>
                            <span className="text-zinc-500">
                              ({formatConverted(Number(listing.price))})
                            </span>
                          </div>
                          <span
                            className={[
                              "rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
                              listingStatusClasses[listing.status] ??
                                "bg-zinc-100 text-zinc-500",
                            ].join(" ")}
                          >
                            {listing.status}
                          </span>
                        </div>
                        {canToggle && (
                          <Button
                            variant={
                              listing.status === "active"
                                ? "danger"
                                : "primary"
                            }
                            size="sm"
                            fullWidth
                            icon={
                              listing.status === "active" ? (
                                <RiEyeOffLine size={16} />
                              ) : (
                                <RiEyeLine size={16} />
                              )
                            }
                            loading={
                              updatingListingId === listing.id
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              handleListingStatusToggle(
                                listing.id,
                                listing.status
                              );
                            }}
                          >
                            {listing.status === "active"
                              ? "Disable"
                              : "Activate"}
                          </Button>
                        )}
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Order Card sub-component ─────────────────────────────────────────────────

function OrderCard({
  order,
  formatConverted,
  onApprove,
  onReject,
  updating,
  showActions,
}: {
  order: SellerOrder;
  formatConverted: (amount: number) => string;
  onApprove?: () => void;
  onReject?: () => void;
  updating: boolean;
  showActions: boolean;
}) {
  const sellerTotal = order.items.reduce(
    (sum, i) => sum + Number(i.price) * i.quantity,
    0
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
            <span className="font-medium text-zinc-700">
              {order.buyerName}
            </span>{" "}
            ({order.buyerEmail})
          </p>
        </div>
        <span
          className={[
            "rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
            statusClasses[order.status] ?? "bg-zinc-100 text-zinc-500",
          ].join(" ")}
        >
          {order.status}
        </span>
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

// ─── Page export ──────────────────────────────────────────────────────────────

export default function SellerDashboardPage() {
  return (
    <ProtectedRoute>
      <SellerDashboardContent />
    </ProtectedRoute>
  );
}
