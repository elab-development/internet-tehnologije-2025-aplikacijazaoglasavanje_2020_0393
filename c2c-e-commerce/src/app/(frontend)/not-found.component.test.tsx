/**
 * H1 — a mistyped URL keeps the app's chrome.
 *
 * A route with no matching segment used to fall through to Next's framework-default
 * 404, which is just as chrome-less as the unhandled-exception screen. This renders
 * inside the (frontend) layout instead, so the navbar and footer stay put.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NotFound from "./not-found";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
}));

describe("H1 — a mistyped URL keeps the app's chrome", () => {
  it("explains and offers a way on", () => {
    render(<NotFound />);
    // Level 1: EmptyState's own title also renders "Page not found" text as an <h2>,
    // and this page has no h1 above it otherwise -- asserting any-level heading here
    // could not catch that (the H8-shaped defect Group B fixed).
    expect(
      screen.getByRole("heading", { name: /page not found/i, level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /browse listings/i }),
    ).toBeInTheDocument();
  });
});
