/**
 * H1 — a mistyped URL keeps the app's chrome.
 *
 * A route with no matching segment used to fall through to Next's framework-default
 * 404, which is just as chrome-less as the unhandled-exception screen. This renders
 * inside the (frontend) layout instead, so the navbar and footer stay put.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "./not-found";

describe("H1 — a mistyped URL keeps the app's chrome", () => {
  it("explains and offers a way on", () => {
    render(<NotFound />);
    expect(
      screen.getByRole("heading", { name: /page not found/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /browse listings/i }),
    ).toBeInTheDocument();
  });
});
