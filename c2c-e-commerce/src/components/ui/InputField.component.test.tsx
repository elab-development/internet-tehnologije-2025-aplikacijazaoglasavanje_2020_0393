/**
 * `InputFieldProps` was a closed hand-written list, so it accepted no arbitrary
 * attributes — the same M14 defect the review caught on `Button` and missed here.
 * Task 13 had to bolt on an `inputMode` passthrough for exactly this reason; this file
 * pins the general remedy instead.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import InputField from "./InputField";

describe("InputField — arbitrary attribute passthrough", () => {
  it("forwards data-testid and maxLength to the rendered input", () => {
    render(
      <InputField
        label="Email"
        value=""
        onChange={() => {}}
        data-testid="email-input"
        maxLength={5}
      />,
    );
    const input = screen.getByTestId("email-input");
    expect(input).toHaveAttribute("maxlength", "5");
  });

  it("lets a caller-supplied id override the generated one", () => {
    render(<InputField label="Email" value="" onChange={() => {}} id="email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("id", "email");
    // The label's htmlFor must follow the override, or the two stop being connected.
    expect(screen.getByText("Email").closest("label")).toHaveAttribute("for", "email");
  });
});

describe("InputField — the guarantees the component owns", () => {
  it("keeps its own aria-invalid and aria-describedby even if a caller tries to override them", () => {
    render(
      <InputField
        label="Email"
        value=""
        onChange={() => {}}
        error="Email is required"
        aria-invalid={false}
        aria-describedby="something-else"
      />,
    );
    const input = screen.getByLabelText("Email");
    // Attribute-value assertions, not a matcher that throws on "absent" — "false" and
    // "absent" are different states, and only this distinguishes them.
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toMatch(/-error$/);
  });

  it("still wires the generated id to the label and the error text when no id is supplied", () => {
    render(<InputField label="Email" value="" onChange={() => {}} error="Required" />);
    const input = screen.getByLabelText("Email");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Required");
  });
});
