"use client";

import { useState } from "react";

import { Button, Modal } from "@/components/ui";
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

/**
 * Transitions with no path back.
 *
 * The codebase already confirms lesser actions — buying and replacing an AI
 * description both use a Modal, deleting a listing uses window.confirm. These two were
 * the exceptions, and they are plain buttons in a dense grid of order cards.
 */
const DESTRUCTIVE: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  declined: {
    title: "Decline this order?",
    body: "The buyer will be told the order was declined. This cannot be undone.",
  },
  cancelled: {
    title: "Cancel this order?",
    body: "The order will be cancelled and the listing released. This cannot be undone.",
  },
};

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

  const [pending, setPending] = useState<OrderStatus | null>(null);
  const confirmation = pending ? DESTRUCTIVE[pending] : undefined;

  if (available.length === 0) return null;

  function handleClick(to: OrderStatus) {
    if (DESTRUCTIVE[to]) {
      setPending(to);
      return;
    }
    onTransition(to);
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {available.map((action) => (
          <Button
            key={action.to}
            variant={action.variant}
            size="sm"
            disabled={busy}
            onClick={() => handleClick(action.to)}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {pending && confirmation && (
        <Modal
          isOpen
          onClose={() => setPending(null)}
          title={confirmation.title}
        >
          <p className="text-sm text-ink-2">{confirmation.body}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep order
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                const to = pending;
                setPending(null);
                onTransition(to);
              }}
            >
              {ACTIONS.find((action) => action.to === pending)?.label}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
