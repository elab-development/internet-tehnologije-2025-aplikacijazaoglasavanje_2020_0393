/**
 * The app had no live region anywhere, so every async change was silent to a screen
 * reader. react-hot-toast carries its own role="status", so order-placed and
 * review-submitted were announced; search, pagination and loading were not.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AnnouncerProvider, useAnnounce } from "./Announcer";

function Probe() {
  const announce = useAnnounce();
  return (
    <>
      <button onClick={() => announce("12 listings found")}>polite</button>
      <button onClick={() => announce("Upload failed", { assertive: true })}>
        assertive
      </button>
      <button onClick={() => announce("12 listings found")}>again</button>
    </>
  );
}

function setup() {
  return render(
    <AnnouncerProvider>
      <Probe />
    </AnnouncerProvider>,
  );
}

describe("Announcer", () => {
  it("mounts both regions before anything is announced", () => {
    setup();
    // A region that appears at the same moment as its message announces nothing.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("puts a polite message in the status region", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "polite" }));

    expect(screen.getByRole("status")).toHaveTextContent("12 listings found");
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });

  it("puts an assertive message in the alert region", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "assertive" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("re-announces an identical message", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "polite" }));
    const first = screen.getByRole("status").textContent;

    await userEvent.click(screen.getByRole("button", { name: "again" }));
    const second = screen.getByRole("status").textContent;

    // Identical text is not a DOM change, so a screen reader would stay silent on the
    // second search that happened to return the same count. The text must differ by
    // something inaudible.
    expect(second).not.toBe(first);
    expect(second).toContain("12 listings found");
  });

  it("keeps the regions visually hidden", () => {
    setup();
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(screen.getByRole("alert")).toHaveClass("sr-only");
  });
});

describe("useAnnounce outside a provider", () => {
  it("is a no-op rather than a crash", async () => {
    // A component rendered in isolation by a test must not explode.
    render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "polite" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
