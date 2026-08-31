/**
 * Part 4 spec §6.4 — "Leave a review", on the order.
 *
 * The order is the thing being reviewed, so this posts to `/api/orders/{id}/review`. The
 * 409 case matters as much as the happy path: two tabs, or a double click, and the second
 * write is refused by the unique index rather than by anything this component knows.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReviewForm from "./ReviewForm";

const post = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: { post } }));
vi.mock("react-hot-toast", () => ({
  default: { success: toastSuccess, error: toastError },
}));

beforeEach(() => {
  post.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Leave a review" }));
}

describe("ReviewForm", () => {
  it("posts the rating and comment against the order", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ id: 5 });
    const onSubmitted = vi.fn();

    render(<ReviewForm orderId={12} onSubmitted={onSubmitted} />);
    await open(user);

    await user.click(screen.getByLabelText("Set rating to 4"));
    await user.type(screen.getByLabelText("Comment"), "Shipped fast.");
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/orders/12/review", {
        rating: 4,
        comment: "Shipped fast.",
      }),
    );
    expect(onSubmitted).toHaveBeenCalled();
  });

  it("defaults to five stars, so a submit with no click still means something", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ id: 5 });

    render(<ReviewForm orderId={3} onSubmitted={vi.fn()} />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/orders/3/review", {
        rating: 5,
        comment: "",
      }),
    );
  });

  it("shows the server's message when the write is refused", async () => {
    // The 409 the unique index produces: two tabs, or a double click. The component does
    // not try to predict it — it reports what the server said.
    const user = userEvent.setup();
    post.mockRejectedValue(new Error("You have already reviewed this order"));
    const onSubmitted = vi.fn();

    render(<ReviewForm orderId={9} onSubmitted={onSubmitted} />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("You have already reviewed this order")).toBeInTheDocument();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("disables submit while the write is in flight", async () => {
    // A second click would be refused by the unique index rather than accepted, which is
    // correct and a confusing thing to show someone who simply double-clicked. `Button`
    // disables itself on `loading`, so the guard is one prop rather than a flag this
    // component has to keep in step with the request.
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    render(<ReviewForm orderId={4} onSubmitted={vi.fn()} />);
    await open(user);

    const submit = screen.getByRole("button", { name: "Submit review" });
    await user.click(submit);

    expect(submit).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);

    release({ id: 1 });
  });
});
