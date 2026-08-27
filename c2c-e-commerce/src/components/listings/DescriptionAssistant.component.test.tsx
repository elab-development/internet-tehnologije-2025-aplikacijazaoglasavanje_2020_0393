/**
 * C2C-AI-6 spec — the "Generate with AI" control.
 *
 * Extracted from `ListingForm` rather than inlined: the form is already 250 lines, and a
 * control with a loading state, a disabled state, an overwrite confirmation and an error
 * banner is far easier to pin down on its own. `ListingForm.component.test.tsx` covers the
 * half that only makes sense in the form — the textarea being filled and the edited text
 * being what gets saved.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DescriptionAssistant from "./DescriptionAssistant";

const auth = vi.hoisted(() => ({ role: "seller" as string | null }));
const post = vi.hoisted(() => vi.fn());

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: auth.role ? { id: 1, name: "Ada", email: "a@b.c", role: auth.role } : null,
    loading: false,
    isAuthenticated: auth.role !== null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({ api: { post } }));

const generated = {
  description: "A well-loved aluminium mountain bike, ready for the trails.",
  model: "mock-llm-v1",
  generatedAt: "2026-08-27T00:00:00.000Z",
};

function setup(props: Partial<React.ComponentProps<typeof DescriptionAssistant>> = {}) {
  const onGenerated = vi.fn();
  render(
    <DescriptionAssistant
      title="Mountain bike"
      hasDescription={false}
      onGenerated={onGenerated}
      {...props}
    />,
  );
  return { onGenerated, user: userEvent.setup() };
}

const generateButton = () => screen.getByRole("button", { name: /generate with ai/i });

beforeEach(() => {
  auth.role = "seller";
  post.mockReset();
  post.mockResolvedValue(generated);
});

describe("C2C-AI-6 — AC7: who sees the button", () => {
  it("AC7: a buyer never sees it", () => {
    auth.role = "buyer";
    setup();

    // The form's own gate is a wrapper the caller supplies; this component does not rely
    // on it, because AC7 is about a buyer who reached the form anyway.
    expect(screen.queryByRole("button", { name: /generate with ai/i })).toBeNull();
  });

  it("AC7: an anonymous visitor never sees it", () => {
    auth.role = null;
    setup();
    expect(screen.queryByRole("button", { name: /generate with ai/i })).toBeNull();
  });

  it("AC7: a seller sees it", () => {
    setup();
    expect(generateButton()).toBeInTheDocument();
  });

  it("AC7: an admin sees it", () => {
    auth.role = "admin";
    setup();
    expect(generateButton()).toBeInTheDocument();
  });
});

describe("C2C-AI-6 — AC5: the title gate", () => {
  it("AC5: disabled when the title is empty", () => {
    setup({ title: "" });
    expect(generateButton()).toBeDisabled();
  });

  it("AC5: disabled when the title is under three characters", () => {
    setup({ title: "ab" });
    expect(generateButton()).toBeDisabled();
  });

  it("AC5: disabled when the title is only whitespace", () => {
    setup({ title: "   " });
    expect(generateButton()).toBeDisabled();
  });

  it("AC5: carries a tooltip explaining why it is disabled", () => {
    setup({ title: "ab" });

    // A disabled control with no explanation is the frustrating kind.
    expect(generateButton()).toHaveAttribute("title", expect.stringMatching(/title/i));
  });

  it("AC5: enabled at exactly three characters", () => {
    setup({ title: "BMX" });
    expect(generateButton()).toBeEnabled();
  });
});

describe("C2C-AI-6 — AC1: generating", () => {
  it("AC1: calls the endpoint with the title", async () => {
    const { user } = setup({ title: "Mountain bike" });
    await user.click(generateButton());

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe("/api/listings/generate-description");
    expect(post.mock.calls[0][1]).toMatchObject({ title: "Mountain bike" });
  });

  it("AC1: hands the generated description to the caller", async () => {
    const { user, onGenerated } = setup();
    await user.click(generateButton());

    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(generated.description));
  });

  it("AC1: shows a loading state while the request is in flight", async () => {
    let release!: (value: typeof generated) => void;
    post.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const { user } = setup();
    await user.click(generateButton());

    await waitFor(() => expect(generateButton()).toBeDisabled());
    release(generated);
    await waitFor(() => expect(generateButton()).toBeEnabled());
  });

  it("AC1: sends the keywords the seller typed", async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText(/keywords/i), "26 inch, aluminium");
    await user.click(generateButton());

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ keywords: ["26 inch", "aluminium"] });
  });

  it("AC1: omits keywords entirely when none were typed", async () => {
    const { user } = setup();
    await user.click(generateButton());

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).not.toHaveProperty("keywords");
  });

  it("AC1: drops blank entries rather than sending empty keywords", async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText(/keywords/i), "26 inch, , aluminium,");
    await user.click(generateButton());

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ keywords: ["26 inch", "aluminium"] });
  });
});

describe("C2C-AI-6 — AC6: no double submission", () => {
  it("AC6: a second click while in flight does not fire a second request", async () => {
    let release!: (value: typeof generated) => void;
    post.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const { user } = setup();
    const button = generateButton();

    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(post).toHaveBeenCalledTimes(1);
    release(generated);
  });
});

describe("C2C-AI-6 — AC2: overwriting an existing description", () => {
  it("AC2: asks before overwriting", async () => {
    const { user } = setup({ hasDescription: true });
    await user.click(generateButton());

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("AC2: cancelling leaves the description untouched and sends nothing", async () => {
    const { user, onGenerated } = setup({ hasDescription: true });
    await user.click(generateButton());

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(post).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("AC2: confirming generates and replaces", async () => {
    const { user, onGenerated } = setup({ hasDescription: true });
    await user.click(generateButton());

    // Scoped to the dialog: "Generate with AI" is still on the page behind it, and an
    // unscoped /replace|generate/ matches both.
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /replace it/i }));

    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(generated.description));
  });

  it("AC2: no confirmation when the description is empty", async () => {
    const { user } = setup({ hasDescription: false });
    await user.click(generateButton());

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("C2C-AI-6 — AC4: when the API fails", () => {
  it("AC4: shows a readable message rather than a status code", async () => {
    post.mockRejectedValue(new Error("Generation limit reached. Try again later."));

    const { user } = setup();
    await user.click(generateButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/generation limit reached/i);
    expect(alert.textContent).not.toMatch(/\b(429|502)\b/);
  });

  it("AC4: the description is left untouched", async () => {
    post.mockRejectedValue(new Error("Description generation is unavailable."));

    const { user, onGenerated } = setup();
    await user.click(generateButton());

    await screen.findByRole("alert");
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("AC4: the button becomes clickable again", async () => {
    post.mockRejectedValue(new Error("Description generation is unavailable."));

    const { user } = setup();
    await user.click(generateButton());

    await screen.findByRole("alert");
    expect(generateButton()).toBeEnabled();
  });

  it("AC4: a retry after a failure does reach the endpoint", async () => {
    post.mockRejectedValueOnce(new Error("Description generation is unavailable."));

    const { user, onGenerated } = setup();
    await user.click(generateButton());
    await screen.findByRole("alert");

    post.mockResolvedValue(generated);
    await user.click(generateButton());

    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(generated.description));
  });

  it("AC4: the error clears once a retry succeeds", async () => {
    post.mockRejectedValueOnce(new Error("Description generation is unavailable."));

    const { user } = setup();
    await user.click(generateButton());
    await screen.findByRole("alert");

    post.mockResolvedValue(generated);
    await user.click(generateButton());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("AC4: falls back to a generic message when the error carries none", async () => {
    post.mockRejectedValue(new Error(""));

    const { user } = setup();
    await user.click(generateButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.trim().length).toBeGreaterThan(0);
  });
});

describe("C2C-AI-6 — AC8: layout", () => {
  it("AC8: the row wraps rather than overflowing a narrow viewport", () => {
    // jsdom has no layout engine, so this asserts the mechanism that prevents overflow.
    // A real 375 px viewport check belongs to Playwright in QA-7/QA-8.
    const { container } = render(
      <DescriptionAssistant title="Mountain bike" hasDescription={false} onGenerated={vi.fn()} />,
    );

    const row = container.querySelector("[data-testid='assistant-row']");
    expect(row).not.toBeNull();
    expect(row!.className).toMatch(/flex-wrap/);
  });

  it("AC8: the keywords input can shrink inside the flex row", () => {
    // Without min-w-0 a flex item refuses to shrink below its content width, which is the
    // usual cause of a row overflowing on a phone.
    render(
      <DescriptionAssistant title="Mountain bike" hasDescription={false} onGenerated={vi.fn()} />,
    );

    const wrapper = screen.getByLabelText(/keywords/i).closest("div");
    expect(wrapper?.className).toMatch(/min-w-0/);
  });
});
