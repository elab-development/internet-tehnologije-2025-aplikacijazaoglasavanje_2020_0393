import type { ListingStatus, OrderStatus } from "@/types/api";

// ─── Styles ───────────────────────────────────────────────────────────────────
// Declared once at module level: these used to live in three separate maps, one
// of which was rebuilt inside a `.map()` callback on every render.

const orderStatusClasses: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-green-100 text-green-700",
  shipped: "bg-indigo-100 text-indigo-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  declined: "bg-red-100 text-red-700",
  expired: "bg-zinc-100 text-zinc-500",
};

const listingStatusClasses: Record<ListingStatus, string> = {
  draft: "bg-zinc-100 text-zinc-500",
  active: "bg-emerald-100 text-emerald-700",
  reserved: "bg-amber-100 text-amber-700",
  sold: "bg-blue-100 text-blue-700",
  removed: "bg-zinc-100 text-zinc-500",
};

/** Buyer-facing wording for an order status. */
const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "Awaiting seller confirmation",
  confirmed: "Confirmed by seller",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Declined by seller",
  expired: "Reservation expired",
};

const FALLBACK_CLASSES = "bg-zinc-100 text-zinc-500";

const sizeClasses = {
  sm: "px-2.5 py-1",
  md: "px-3 py-1",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatusBadgeProps = {
  status: string;
  /** Which colour map to read. Defaults to order statuses. */
  kind?: "order" | "listing";
  /**
   * Show the descriptive order wording ("Awaiting seller approval") instead of
   * the raw status. Order statuses only.
   */
  descriptive?: boolean;
  size?: keyof typeof sizeClasses;
  className?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

/** Coloured pill for an order or listing status. */
export default function StatusBadge({
  status,
  kind = "order",
  descriptive = false,
  size = "sm",
  className = "",
}: StatusBadgeProps) {
  const classes =
    kind === "listing"
      ? listingStatusClasses[status as ListingStatus]
      : orderStatusClasses[status as OrderStatus];

  const label =
    kind === "order" && descriptive
      ? (orderStatusLabels[status as OrderStatus] ?? status)
      : status;

  return (
    <span
      className={[
        "rounded-full text-xs font-semibold",
        sizeClasses[size],
        descriptive ? "" : "capitalize",
        classes ?? FALLBACK_CLASSES,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </span>
  );
}
