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

/**
 * Short buyer-facing wording for an order status, used when `descriptive` is not
 * set. Previously the non-descriptive badge fell back to the raw enum value with a
 * CSS `capitalize` class — which capitalizes only the rendered glyphs, not the text
 * node, so a status with no map entry was indistinguishable from one with a real
 * label at the DOM level.
 */
const orderStatusShortLabels: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Declined",
  expired: "Expired",
};

/** Buyer-facing wording for a listing status. */
const listingStatusLabels: Record<ListingStatus, string> = {
  draft: "Draft",
  active: "Active",
  reserved: "Reserved",
  sold: "Sold",
  removed: "Removed",
};

/**
 * Visually neutral — deliberately not one of the map colours above, which would
 * imply a real (and wrong) meaning for a status this frontend has not been taught.
 */
const UNKNOWN_CLASSES = "bg-zinc-100 text-zinc-500";
const UNKNOWN_LABEL = "Unknown status";

const sizeClasses = {
  sm: "px-2.5 py-1",
  md: "px-3 py-1",
} as const;

type Size = keyof typeof sizeClasses;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Discriminated on `kind`: `status` is only ever a value the chosen map can index,
 * so `status="sold"` (a listing status) can no longer be passed to an order badge —
 * previously `status` was a bare `string`, cast into whichever map `kind` picked,
 * and a mismatch like that rendered grey with no error anywhere (L8).
 *
 * `kind` defaults to `"order"` for the many callers that never set it; a listing
 * badge must say so explicitly.
 */
export type StatusBadgeProps =
  | {
      kind?: "order";
      status: OrderStatus;
      /**
       * Show the descriptive order wording ("Awaiting seller approval") instead of
       * the raw status. Order statuses only.
       */
      descriptive?: boolean;
      size?: Size;
      className?: string;
    }
  | {
      kind: "listing";
      status: ListingStatus;
      descriptive?: boolean;
      size?: Size;
      className?: string;
    };

// ─── Component ────────────────────────────────────────────────────────────────

/** Coloured pill for an order or listing status. */
export default function StatusBadge(props: StatusBadgeProps) {
  const { size = "sm", className = "", descriptive = false } = props;

  // The maps above are `Record<Status, string>`, so a status the compiler knows
  // about can never miss — that case is a compile error now, not this fallback.
  // What survives is real drift: the API adding a status this frontend has not
  // been taught yet, which arrives as a value outside the typed union at runtime
  // even though nothing here can express that possibility statically.
  let classes: string | undefined;
  let label: string | undefined;

  if (props.kind === "listing") {
    classes = listingStatusClasses[props.status];
    label = listingStatusLabels[props.status];
  } else {
    classes = orderStatusClasses[props.status];
    label = descriptive
      ? orderStatusLabels[props.status]
      : orderStatusShortLabels[props.status];
  }

  if (label === undefined) {
    // Drift between the API's enum and this component's map. Rendering the raw slug
    // put database vocabulary in front of users; this is at least honest, and the
    // console error is what makes the drift findable.
    console.error(
      `StatusBadge: no label for ${props.kind ?? "order"} status "${props.status}"`,
    );
  }

  return (
    <span
      className={[
        "rounded-full text-xs font-semibold",
        sizeClasses[size],
        descriptive ? "" : "capitalize",
        classes ?? UNKNOWN_CLASSES,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label ?? UNKNOWN_LABEL}
    </span>
  );
}
