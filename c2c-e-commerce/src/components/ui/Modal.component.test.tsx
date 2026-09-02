/**
 * Modal owned an Escape listener and a document.body.style.overflow lock but had no
 * focus management at all: no initial focus, no Tab containment, no restore on close.
 *
 * These tests drive real focus order through user-event, which jsdom supports. This is
 * the part axe-core could not have covered (spec 7.2).
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Modal from "./Modal";

function open() {
  return render(
    <>
      <button>outside before</button>
      <Modal isOpen onClose={vi.fn()} title="Confirm purchase">
        <button>Cancel</button>
        <button>Confirm</button>
      </Modal>
      <button>outside after</button>
    </>,
  );
}

describe("Modal — focus management", () => {
  it("moves focus into the dialog when it opens", () => {
    open();
    // The panel itself takes focus, so the next Tab lands on the first control inside.
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("keeps Tab inside the dialog, wrapping from the last control to the first", async () => {
    const user = userEvent.setup();
    open();

    await user.tab();
    expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();

    expect(screen.getByRole("button", { name: "outside after" })).not.toHaveFocus();
  });

  it("wraps backwards from the first control to the last", async () => {
    const user = userEvent.setup();
    open();

    await user.tab();
    expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
  });

  it("wraps backwards to the last control when Shift+Tab is the first key after opening", async () => {
    const user = userEvent.setup();
    open();

    // No Tab has been pressed yet, so the panel itself still holds focus. Without the
    // `active === panel` clause the handler no-ops here and native Shift+Tab walks
    // focus backwards out of the dialog, onto "outside before".
    expect(screen.getByRole("dialog")).toHaveFocus();

    await user.tab({ shift: true });

    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "outside before" })).not.toHaveFocus();
  });

  it("restores focus to the element that was focused before it opened", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [isOpen, setIsOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setIsOpen(true)}>Buy now</button>
          <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Confirm purchase">
            <button onClick={() => setIsOpen(false)}>Confirm</button>
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Buy now" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(trigger).toHaveFocus();
  });
});

describe("Modal — accessible name", () => {
  it("names the dialog from its heading without a hardcoded id", () => {
    render(
      <>
        <Modal isOpen onClose={vi.fn()} title="First dialog">
          <p>one</p>
        </Modal>
        <Modal isOpen onClose={vi.fn()} title="Second dialog">
          <p>two</p>
        </Modal>
      </>,
    );

    // Two modals mounted together used to emit duplicate id="modal-title", so the
    // second dialog's name resolved to the first one's heading.
    expect(screen.getByRole("dialog", { name: "First dialog" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Second dialog" })).toBeInTheDocument();
  });

  it("puts the dialog role on the panel, not the backdrop", () => {
    open();
    const dialog = screen.getByRole("dialog");
    // The overlay is a sibling of the panel, not a descendant of the dialog. Targeted by
    // its own class rather than `[aria-hidden='true']`: the close button's icon (L24)
    // is now a legitimate `aria-hidden` descendant of the dialog too, so a selector that
    // matched any `aria-hidden` element would no longer isolate the backdrop.
    expect(dialog.querySelector(".backdrop-blur-sm")).toBeNull();
  });
});

describe("Modal — behaviour that already worked and must not regress", () => {
  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Confirm">
        <button>Confirm</button>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("releases the body scroll lock on unmount", () => {
    const { unmount } = open();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
