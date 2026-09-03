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

// ─── View button ──────────────────────────────────────────────────────────────

/**
 * A view switch, deliberately not an ARIA tab.
 *
 * The tabs pattern was declared here without tabpanels, aria-controls, roving tabindex
 * or arrow-key navigation, so a screen reader user was told they were in a tab widget
 * and then found the arrow keys did nothing. Two view switches do not need the pattern;
 * they need to be honest about what they are.
 */
function ViewButton({
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
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={[
        "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
        active
          ? "border-ink text-black"
          : "border-transparent text-ink-3 hover:text-ink-2",
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
  //
  // `limit=100` is the API's own maximum: this dashboard has no pager (that is a separate
  // frontend pass), so asking for as many rows as the server will give in one request is
  // what keeps incoming orders from silently truncating at the default limit for a seller
  // with a real sales history.
  const ordersFetch = useFetch<SellerOrdersResponse>("/api/orders/seller?limit=100");
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
          <h1 className="text-2xl font-bold text-ink">Seller Dashboard</h1>
          <p className="text-sm text-ink-3 mt-1">
            Manage your listings and incoming orders
          </p>
        </div>

        <CurrencySelect conversion={conversion} className="sm:w-48" />
      </div>

      {/* View switch */}
      <div className="flex gap-1 border-b border-rule">
        <ViewButton active={tab === "orders"} onClick={() => setTab("orders")}>
          Incoming Orders
          {pendingCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-none bg-wait-tint px-2 py-0.5 text-xs font-semibold text-wait-ink">
              {pendingCount}
            </span>
          )}
        </ViewButton>
        <ViewButton
          active={tab === "listings"}
          onClick={() => setTab("listings")}
        >
          My Listings
        </ViewButton>
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
    <ProtectedRoute allowedRoles={["seller", "admin"]}>
      <SellerDashboardContent />
    </ProtectedRoute>
  );
}
