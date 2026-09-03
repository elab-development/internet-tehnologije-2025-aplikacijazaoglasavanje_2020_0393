/**
 * C2C-QA-2 spec — AC5: a `.component.test.tsx` file runs in jsdom with jest-dom matchers.
 *
 * This is the canary for the component project: if it runs at all, the project exists,
 * the jsdom environment is wired, and the setup file registered `@testing-library/jest-dom`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}

describe("C2C-QA-2 — component project", () => {
  it("AC5: renders into a jsdom document", () => {
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");

    render(<Greeting name="thesis" />);
    expect(screen.getByText("Hello, thesis")).toBeInTheDocument();
  });

  it("AC5: unmounts cleanly between tests", () => {
    expect(screen.queryByText("Hello, thesis")).not.toBeInTheDocument();
  });
});
