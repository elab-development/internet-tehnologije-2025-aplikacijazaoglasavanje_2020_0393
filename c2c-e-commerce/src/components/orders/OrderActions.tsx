"use client";

import { Button } from "@/components/ui";
import {
  canTransition,
  type OrderActor,
  type OrderStatus,
} from "@/lib/order-lifecycle";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderActionsProps = {
  status: OrderStatus;
  /** The viewer's relationship to this order, not their role. */
  actor: OrderActor;
  /** A transition is in flight; every control is disabled until it settles. */
  busy?: boolean;
  onTransition: (to: OrderStatus) => void;
};

// ─── Actions ──────────────────────────────────────────────────────────────────
// Every transition a human can drive, in the order they should be offered. Which of them
// appear is `canTransition`'s decision — this list only supplies the wording, so the UI
// cannot offer something the API will refuse.

const ACTIONS: Array<{
  to: OrderStatus;
  label: string;
  variant: "primary" | "secondary" | "danger";
}> = [
  { to: "confirmed", label: "Confirm order", variant: "primary" },
  { to: "shipped", label: "Mark as shipped", variant: "primary" },
  { to: "completed", label: "Mark as received", variant: "primary" },
  { to: "declined", label: "Decline order", variant: "danger" },
  { to: "cancelled", label: "Cancel order", variant: "danger" },
  { to: "expired", label: "Mark as expired", variant: "secondary" },
];

// ─── Component ────────────────────────────────────────────────────────────────

/** The transitions this actor may drive from this status. Renders nothing if none. */
export default function OrderActions({
  status,
  actor,
  busy = false,
  onTransition,
}: OrderActionsProps) {
  const available = ACTIONS.filter((action) =>
    canTransition(status, action.to, actor),
  );

  if (available.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {available.map((action) => (
        <Button
          key={action.to}
          variant={action.variant}
          size="sm"
          disabled={busy}
          onClick={() => onTransition(action.to)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
