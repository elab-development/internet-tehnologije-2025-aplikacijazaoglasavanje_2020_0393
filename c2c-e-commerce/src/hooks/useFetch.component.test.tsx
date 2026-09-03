/**
 * Two findings in one hook.
 *
 * M4: `loading` and `data` were independent state and setLoading(true) ran in a passive
 * effect, so a render happened with the PREVIOUS endpoint's data and loading:false —
 * one painted frame of the wrong listing at the new URL.
 *
 * M8: every failure raised a toast, including for sections that document themselves as
 * silent on error.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useLayoutEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";

import { useFetch } from "./useFetch";

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

let resolvers: Array<(value: unknown) => void>;

/** Every COMMITTED render's (data, loading) pair, in order. Pushed from a layout
 *  effect rather than during render: a render-phase setState makes React discard that
 *  pass and re-invoke the component, but the discarded pass still runs its body, so a
 *  bare push during render can't tell a committed frame from a discarded-and-retried
 *  one. useLayoutEffect fires only for renders that actually committed. */
let renderLog: string[];

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(
      () => new Promise((resolve) => { resolvers.push(resolve); }),
    ),
  },
}));

beforeEach(() => {
  resolvers = [];
  renderLog = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Probe({ endpoint, silent }: { endpoint: string; silent?: boolean }) {
  const { data, loading } = useFetch<{ title: string }>(
    endpoint,
    silent ? { onError: "silent" } : undefined,
  );

  // Logged from a layout effect, not during render. A render pass discarded by a
  // render-phase setState still executes its body, so a bare push cannot tell a
  // committed frame from a discarded-and-retried one. useLayoutEffect fires only
  // for renders that actually committed — which is what "a painted frame" means.
  useLayoutEffect(() => {
    renderLog.push(`${data?.title ?? "none"}|${loading}`);
  });

  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="title">{data?.title ?? "none"}</span>
    </div>
  );
}

describe("useFetch — data and loading can never disagree", () => {
  it("never renders the previous endpoint's data with loading false", async () => {
    const { rerender } = render(<Probe endpoint="/api/listings/1" />);

    resolvers.shift()!({ title: "First listing" });
    await waitFor(() => expect(screen.getByTestId("title")).toHaveTextContent("First listing"));

    // Only the renders caused by the endpoint switch matter.
    renderLog = [];
    rerender(<Probe endpoint="/api/listings/2" />);

    // With the reset in render, the very first render at the new endpoint is already
    // cleared. With the reset in an effect, React renders once with listing 1's data
    // and loading:false before the effect runs — that render is the bug.
    expect(renderLog[0]).toBe("none|true");
    expect(renderLog).not.toContain("First listing|false");
  });
});

describe("useFetch — error reporting is opt-out", () => {
  it("toasts by default, as all eleven existing consumers expect", async () => {
    render(<Probe endpoint="/api/listings" />);
    resolvers.shift()!(Promise.reject(new Error("Network down")));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Network down"));
  });

  it("stays silent when the caller asks it to", async () => {
    render(<Probe endpoint="/api/recommendations" silent />);
    resolvers.shift()!(Promise.reject(new Error("Network down")));

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("useFetch — the race guard that already worked", () => {
  it("discards a response that arrives after the endpoint changed", async () => {
    const { rerender } = render(<Probe endpoint="/api/listings/1" />);
    const staleResolve = resolvers.shift()!;

    rerender(<Probe endpoint="/api/listings/2" />);
    const freshResolve = resolvers.shift()!;

    // The first request answers last — the classic search-as-you-type race.
    freshResolve({ title: "Second listing" });
    staleResolve({ title: "First listing" });

    await waitFor(() =>
      expect(screen.getByTestId("title")).toHaveTextContent("Second listing"),
    );
    expect(screen.getByTestId("title")).not.toHaveTextContent("First listing");
  });
});
