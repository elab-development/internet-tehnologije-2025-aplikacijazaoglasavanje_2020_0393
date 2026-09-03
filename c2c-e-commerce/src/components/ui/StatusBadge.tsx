import type { ListingStatus, OrderStatus } from "@/types/api";

// ─── Styles ───────────────────────────────────────────────────────────────────
// Declared once at module level: these used to live in three separate maps, one
// of which was rebuilt inside a `.map()` callback on every render.

/**
 * State gets its own three colours — go, wait, stop — plus solid and outline ink.
 * None of them is one of the five category hues, and that is deliberate: a status
 * chip and a category label sit next to each other on a card, and a chip borrowing
 * a category colour would read as a second category.
 */
type Tone = "go" | "wait" | "stop" | "solid" | "outline" | "muted";

const toneClasses: Record<Tone, string> = {
  go: "bg-go-tint text-go-ink ring-1 ring-inset ring-go-rule",
  wait: "bg-wait-tint text-wait-ink ring-1 ring-inset ring-wait-rule",
  stop: "bg-stop-tint text-stop-ink ring-1 ring-inset ring-stop-rule",
  solid: "bg-ink text-white",
  outline: "text-ink ring-[1.5px] ring-inset ring-ink",
  muted: "bg-inset text-ink-3 ring-1 ring-inset ring-rule",
};

const orderStatusTones: Record<OrderStatus, Tone> = {
  pending: "wait",
  confirmed: "go",
  shipped: "solid",
  completed: "go",
  cancelled: "stop",
  declined: "stop",
  expired: "muted",
};

const listingStatusTones: Record<ListingStatus, Tone> = {
  draft: "muted",
  active: "go",
  reserved: "wait",
  sold: "outline",
  removed: "muted",
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
 * Visually neutral — deliberately not one of the tones above, which would
 * imply a real (and wrong) meaning for a status this frontend has not been taught.
 */
const UNKNOWN_TONE: Tone = "muted";
const UNKNOWN_LABEL = "Unknown status";

const sizeClasses = {
  sm: "px-2 py-1",
  md: "px-2.5 py-1",
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
       * Show the descriptive order wording ("Awaiting seller confirmation") instead of
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

/** Square status chip with a leading block, for an order or a listing. */
export default function StatusBadge(props: StatusBadgeProps) {
  const { size = "sm", className = "", descriptive = false } = props;

  // The maps above are `Record<Status, string>`, so a status the compiler knows
  // about can never miss — that case is a compile error now, not this fallback.
  // What survives is real drift: the API adding a status this frontend has not
  // been taught yet, which arrives as a value outside the typed union at runtime
  // even though nothing here can express that possibility statically.
  let tone: Tone | undefined;
  let label: string | undefined;

  if (props.kind === "listing") {
    tone = listingStatusTones[props.status];
    label = listingStatusLabels[props.status];
  } else {
    tone = orderStatusTones[props.status];
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
        "inline-flex items-center gap-[7px] rounded-none text-[10px] font-bold uppercase leading-relaxed tracking-[0.1em] whitespace-nowrap",
        sizeClasses[size],
        toneClasses[tone ?? UNKNOWN_TONE],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="h-[7px] w-[7px] shrink-0 bg-current" aria-hidden="true" />
      {label ?? UNKNOWN_LABEL}
    </span>
  );
}
