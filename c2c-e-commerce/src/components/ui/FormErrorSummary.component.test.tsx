/**
 * M10 spec — one summary for a form's validation failures.
 *
 * A blank submit used to fire one `role="alert"` region per invalid field
 * simultaneously; they queue or clobber each other, so a screen reader user heard one
 * message or a fragment with no idea how many fields had failed. `FormErrorSummary` is
 * the single, focusable place that lists them all.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import FormErrorSummary from "./FormErrorSummary";

describe("FormErrorSummary", () => {
  it("renders nothing when there are no errors", () => {
    const { container } = render(<FormErrorSummary errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many fields failed", () => {
    render(
      <FormErrorSummary
        errors={[
          { field: "email", message: "Email is required" },
          { field: "password", message: "Password is required" },
        ]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/2 fields need attention/i);
  });

  it("uses singular wording for a single failed field", () => {
    render(<FormErrorSummary errors={[{ field: "email", message: "Email is required" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/1 field needs attention/i);
  });

  it("links each message to its field", () => {
    render(<FormErrorSummary errors={[{ field: "email", message: "Email is required" }]} />);
    expect(screen.getByRole("link", { name: "Email is required" })).toHaveAttribute(
      "href",
      "#email",
    );
  });

  it("takes focus so a keyboard user meets it immediately", () => {
    render(<FormErrorSummary errors={[{ field: "email", message: "Email is required" }]} />);
    // Rendered above the form, where tabbing forward would never reach it.
    expect(screen.getByRole("alert")).toHaveFocus();
  });
});
