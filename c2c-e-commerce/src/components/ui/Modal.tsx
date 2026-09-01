"use client";

import { useEffect, useId, useRef } from "react";
import { RiCloseLine } from "@remixicon/react";

/**
 * Everything inside the panel a user can Tab to.
 *
 * Deliberately not filtered by visibility: `offsetParent` is always null in jsdom, so a
 * visibility filter would behave differently under test than in a browser — and the
 * panel does not hide its own controls.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Extra classes applied to the inner panel */
  className?: string;
  /** Prevent closing when clicking the backdrop */
  disableBackdropClose?: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  className = "",
  disableBackdropClose = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // A hardcoded id made two simultaneous modals emit duplicate ids, so the second
  // dialog's accessible name resolved to the first one's heading.
  const titleId = useId();

  // Close on Escape, and keep Tab inside the panel while open.
  useEffect(() => {
    if (!isOpen) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );

      // A dialog with nothing focusable still must not leak focus to the page behind.
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        // The panel itself holds focus immediately after opening, so treat it as
        // "before the first item" when wrapping backwards.
        if (active === first || active === panel) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Take focus on open; give it back on close.
  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      const previous = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // The trigger may have unmounted while the dialog was open.
      if (previous?.isConnected) previous.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Semi-transparent overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={disableBackdropClose ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[
          "relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-xl",
          "flex flex-col max-h-[90vh] focus:outline-none",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <h2
            id={titleId}
            className="text-lg font-semibold text-zinc-900"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <RiCloseLine size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
