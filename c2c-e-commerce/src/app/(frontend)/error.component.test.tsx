/**
 * H1 — a thrown render recovers instead of whiting out.
 *
 * Every page under (frontend) is a client component, so a render-time throw used to
 * unwind to the root and replace the whole document with Next's bare "Application
 * error" screen. This segment error boundary keeps the app's chrome and offers both a
 * retry and a way back to the marketplace.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ErrorBoundaryPage from "./error";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
}));

describe("H1 — a thrown render recovers instead of whiting out", () => {
  it("offers a way to retry", async () => {
    const reset = vi.fn();
    render(<ErrorBoundaryPage error={new Error("boom")} reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("offers a way back to the marketplace", async () => {
    nav.push.mockClear();
    render(<ErrorBoundaryPage error={new Error("boom")} reset={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /browse listings/i }));
    expect(nav.push).toHaveBeenCalledWith("/listings");
  });

  it("does not put the raw error message on the page", () => {
    // Stack traces and internal messages are not user-facing copy.
    render(
      <ErrorBoundaryPage
        error={new Error("ECONNREFUSED 10.0.0.4:5432")}
        reset={vi.fn()}
      />,
    );
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
  });
});
