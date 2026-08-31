"use client";

import { useState } from "react";
import CurrencySelect from "@/components/CurrencySelect";
import ProtectedRoute from "@/components/ProtectedRoute";
import SellerListingsTab from "@/components/seller/SellerListingsTab";
import SellerOrdersTab from "@/components/seller/SellerOrdersTab";
import { useCurrencyConversion } from "@/hooks/useCurrencyConversion";
import { useFetch } from "@/hooks/useFetch";
import type { SellerOrdersResponse } from "@/types/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "listings" | "orders";

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
        active
          ? "border-indigo-600 text-indigo-700"
          : "border-transparent text-zinc-500 hover:text-zinc-700",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ─── Content component ────────────────────────────────────────────────────────

function SellerDashboardContent() {
  const [tab, setTab] = useState<Tab>("orders");

  // Fetched here rather than inside the orders tab so the pending count stays
  // on the tab strip while the listings tab is on screen.
  const ordersFetch = useFetch<SellerOrdersResponse>("/api/orders/seller");
  const pendingCount = (ordersFetch.data?.data ?? []).filter(
    (order) => order.status === "pending",
  ).length;

  const conversion = useCurrencyConversion();
  const { formatConverted } = conversion;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Seller Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage your listings and incoming orders
          </p>
        </div>

        <CurrencySelect conversion={conversion} className="sm:w-48" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-200" role="tablist">
        <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>
          Incoming Orders
          {pendingCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              {pendingCount}
            </span>
          )}
        </TabButton>
        <TabButton
          active={tab === "listings"}
          onClick={() => setTab("listings")}
        >
          My Listings
        </TabButton>
      </div>

      {tab === "orders" && (
        <SellerOrdersTab
          orders={ordersFetch}
          formatConverted={formatConverted}
        />
      )}

      {tab === "listings" && (
        <SellerListingsTab formatConverted={formatConverted} />
      )}
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
