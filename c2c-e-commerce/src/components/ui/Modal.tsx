"use client";

import { useEffect, useRef } from "react";
import { RiCloseLine } from "@remixicon/react";

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
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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

  if (!isOpen) return null;

  return (
    // Backdrop
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Semi-transparent overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={disableBackdropClose ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={dialogRef}
        className={[
          "relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-xl",
          "flex flex-col max-h-[90vh]",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <h2
            id="modal-title"
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
