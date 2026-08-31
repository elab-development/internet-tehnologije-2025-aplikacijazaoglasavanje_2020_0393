/**
 * C2C-AI-6 spec — the half that only means anything inside the form.
 *
 * AC1's "fills the textarea" and AC3's "the edited text is what is saved" are claims about
 * the form's state, not about the button, so they are tested here against the real
 * `ListingForm`.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ListingForm from "./ListingForm";

const auth = vi.hoisted(() => ({ role: "seller" as string | null }));
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  api: { post, get: vi.fn(), patch, delete: vi.fn() },
}));

// URL-aware, not blanket: the form calls useFetch twice — once for categories and once,
// in edit mode, for the listing itself. A mock returning [] for both makes the edit-mode
// effect read `.description` off an array.
vi.mock("@/hooks/useFetch", () => ({
  useFetch: (endpoint: string | null) => ({
    data: endpoint === "/api/categories" ? [] : null,
    setData: vi.fn(),
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const generated = {
  description: "A well-loved aluminium mountain bike, ready for the trails.",
  model: "mock-llm-v1",
  generatedAt: "2026-08-27T00:00:00.000Z",
};

const descriptionBox = () => screen.getByLabelText(/^description/i);
const generateButton = () => screen.getByRole("button", { name: /generate with ai/i });

beforeEach(() => {
  auth.role = "seller";
  post.mockReset();
  patch.mockReset();
  push.mockReset();
});

describe("C2C-AI-6 — AC1: the generated text lands in the form", () => {
  it("AC1: fills the description field", async () => {
    post.mockResolvedValue(generated);
    const user = userEvent.setup();
    render(<ListingForm mode="create" />);

    await user.type(screen.getByLabelText(/^title/i), "Mountain bike");
    await user.click(generateButton());

    await waitFor(() => expect(descriptionBox()).toHaveValue(generated.description));
  });

  it("AC1: the description field is a textarea, not a single-line input", () => {
    render(<ListingForm mode="create" />);

    // A 60-120 word description in an <input> is unusable, and every AC calls it a
    // textarea.
    expect(descriptionBox().tagName).toBe("TEXTAREA");
  });

  it("AC1: the generated text remains fully editable", async () => {
    post.mockResolvedValue(generated);
    const user = userEvent.setup();
    render(<ListingForm mode="create" />);

    await user.type(screen.getByLabelText(/^title/i), "Mountain bike");
    await user.click(generateButton());
    await waitFor(() => expect(descriptionBox()).toHaveValue(generated.description));

    await user.clear(descriptionBox());
    await user.type(descriptionBox(), "My own words");

    expect(descriptionBox()).toHaveValue("My own words");
  });

  it("marks the description as AI-assisted once generated", async () => {
    post.mockResolvedValue(generated);
    const user = userEvent.setup();
    render(<ListingForm mode="create" />);

    await user.type(screen.getByLabelText(/^title/i), "Mountain bike");
    await user.click(generateButton());

    // The seller should be able to see that a draft came from a model — it is their name
    // on the listing. Matched on the note's own wording: a bare /ai/ also hits the
    // "Generate with AI" button label.
    expect(await screen.findByText(/drafted with ai/i)).toBeInTheDocument();
  });

  it("shows no AI-assisted note before anything is generated", () => {
    render(<ListingForm mode="create" />);
    expect(screen.queryByText(/drafted with ai/i)).toBeNull();
  });
});

describe("C2C-AI-6 — AC3: what gets saved", () => {
  it("AC3: the seller's edit of the generated text is what is submitted", async () => {
    post.mockResolvedValue(generated);
    const user = userEvent.setup();
    render(<ListingForm mode="create" />);

    await user.type(screen.getByLabelText(/^title/i), "Mountain bike");
    await user.click(generateButton());
    await waitFor(() => expect(descriptionBox()).toHaveValue(generated.description));

    await user.clear(descriptionBox());
    await user.type(descriptionBox(), "Edited by the seller.");
    await user.type(screen.getByLabelText(/^price/i), "220");

    post.mockResolvedValue({ id: 1 });
    await user.click(screen.getByRole("button", { name: /create listing|save/i }));

    // Create-as-draft, then publish: the listing is created with status "draft" and only
    // made visible by the follow-up PATCH, so a failed upload in between leaves a draft
    // rather than a half-published listing.
    await waitFor(() => {
      const create = post.mock.calls.find(([url]) => url === "/api/listings");
      expect(create).toBeDefined();
      expect(create![1]).toMatchObject({
        description: "Edited by the seller.",
        status: "draft",
      });
    });
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith("/api/listings/1", { status: "active" });
    });
  });

  it("AC3: the generated text is submitted unchanged when the seller does not edit it", async () => {
    post.mockResolvedValue(generated);
    const user = userEvent.setup();
    render(<ListingForm mode="create" />);

    await user.type(screen.getByLabelText(/^title/i), "Mountain bike");
    await user.click(generateButton());
    await waitFor(() => expect(descriptionBox()).toHaveValue(generated.description));

    await user.type(screen.getByLabelText(/^price/i), "220");

    post.mockResolvedValue({ id: 1 });
    await user.click(screen.getByRole("button", { name: /create listing|save/i }));

    await waitFor(() => {
      const create = post.mock.calls.find(([url]) => url === "/api/listings");
      expect(create![1]).toMatchObject({ description: generated.description });
      expect(create![1]).toMatchObject({ status: "draft" });
    });
  });
});

describe("C2C-AI-6 — AC7: the form without the button", () => {
  it("AC7: a buyer sees the form but no generate button", () => {
    // Positive control first: a seller does see it. Without this, "the buyer sees no
    // button" would hold just as well against a form that has no button at all.
    auth.role = "seller";
    const seller = render(<ListingForm mode="create" />);
    expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
    seller.unmount();

    auth.role = "buyer";
    render(<ListingForm mode="create" />);

    expect(descriptionBox()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate with ai/i })).toBeNull();
  });

  it("AC7: the description remains editable by hand without the button", async () => {
    auth.role = "buyer";
    const user = userEvent.setup();
    render(<ListingForm mode="create" />);

    await user.type(descriptionBox(), "Typed by hand");
    expect(descriptionBox()).toHaveValue("Typed by hand");
  });
});
