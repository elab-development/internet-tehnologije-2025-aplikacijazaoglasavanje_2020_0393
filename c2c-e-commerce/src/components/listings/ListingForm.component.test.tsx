/**
 * C2C-AI-6 spec — the half that only means anything inside the form.
 *
 * AC1's "fills the textarea" and AC3's "the edited text is what is saved" are claims about
 * the form's state, not about the button, so they are tested here against the real
 * `ListingForm`.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ListingForm from "./ListingForm";

const auth = vi.hoisted(() => ({ role: "seller" as string | null }));
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
// Holds the edit-mode listing to serve from useFetch, set per-test by renderEditForm.
// null in every create-mode test, matching the old blanket-null behaviour.
const fetchState = vi.hoisted(() => ({ listing: null as unknown }));

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
  api: { post, get: vi.fn(), patch, delete: del },
}));

// URL-aware, not blanket: the form calls useFetch twice — once for categories and once,
// in edit mode, for the listing itself. A mock returning [] for both makes the edit-mode
// effect read `.description` off an array. The listing branch reads `fetchState.listing`
// so M7's edit-mode test can supply a real listing (with images) without touching the
// other, create-mode-only tests in this file.
vi.mock("@/hooks/useFetch", () => ({
  useFetch: (endpoint: string | null) => ({
    data:
      endpoint === "/api/categories"
        ? []
        : endpoint?.startsWith("/api/listings/")
          ? fetchState.listing
          : null,
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

function renderCreateForm() {
  return render(<ListingForm mode="create" />);
}

function renderEditForm({ images }: { images: Array<{ id: number }> }) {
  fetchState.listing = {
    id: 5,
    title: "Existing listing",
    description: "An existing description of the listing.",
    price: "100",
    categoryId: null,
    status: "active",
    images,
  };
  return render(<ListingForm mode="edit" listingId={5} />);
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^title/i), "Mountain bike");
  await user.type(
    descriptionBox(),
    "A well-loved aluminium mountain bike, ready for the trails.",
  );
  await user.type(screen.getByLabelText(/^price/i), "220");
  // A file is required for the H2 tests to reach the upload step at all — an empty
  // `files` list makes `uploadFiles` a no-op loop that never calls `fetch`.
  await user.upload(
    screen.getByLabelText(/photos/i),
    new File(["x"], "photo-3.jpg", { type: "image/jpeg" }),
  );
}

/** Makes `post` resolve `response` for the create-listing endpoint specifically. */
function mockCreateListing(response: { id: number }) {
  post.mockImplementation(async (url: string) => {
    if (url === "/api/listings") return response;
    return {};
  });
}

function createListingCalls() {
  return post.mock.calls.filter(([url]) => url === "/api/listings");
}

/** The body of the (first) create-listing call, for asserting on the submitted payload. */
function createListingBody() {
  return createListingCalls()[0]?.[1];
}

/** Fills title and description only, leaving price for the test to set. */
async function fillTitleAndDescription(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^title/i), "Mountain bike");
  await user.type(
    descriptionBox(),
    "A well-loved aluminium mountain bike, ready for the trails.",
  );
}

function deleteCalls() {
  return del.mock.calls;
}

/** Makes the image-upload `fetch` (not `api.post`) fail with `message`. */
function mockUploadFailure(message: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: message }),
    }),
  );
}

beforeEach(() => {
  auth.role = "seller";
  fetchState.listing = null;
  post.mockReset();
  patch.mockReset();
  del.mockReset();
  push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe("H2 — a failed upload does not strand or duplicate a draft", () => {
  it("reuses the same draft when the seller retries", async () => {
    const user = userEvent.setup();
    mockCreateListing({ id: 42 });
    mockUploadFailure("Could not upload photo-3.jpg");

    renderCreateForm();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create listing/i }));
    await screen.findByText(/could not upload photo-3\.jpg/i);

    // The retry must not create a second draft. created.id used to be a const inside
    // the try block, so it was lost the moment the upload threw.
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    expect(createListingCalls()).toHaveLength(1);
  });

  it("tells the seller the draft is waiting for them", async () => {
    const user = userEvent.setup();
    mockCreateListing({ id: 42 });
    mockUploadFailure("Could not upload photo-3.jpg");

    renderCreateForm();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    expect(await screen.findByText(/saved as a draft/i)).toBeInTheDocument();
  });
});

describe("M7 — deleting a saved photo asks first", () => {
  it("does not issue the DELETE until confirmed", async () => {
    const user = userEvent.setup();
    renderEditForm({ images: [{ id: 9 }] });

    await user.click(await screen.findByRole("button", { name: /remove image 9/i }));

    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: /remove this photo/i })).toBeInTheDocument();

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /remove photo/i }));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
  });
});

describe("M6 — a comma decimal is a price, not an empty field", () => {
  it("accepts 1500,50 and submits 1500.5", async () => {
    const user = userEvent.setup();
    mockCreateListing({ id: 1 });
    renderCreateForm();
    await fillTitleAndDescription(user);

    await user.type(screen.getByLabelText(/^price/i), "1500,50");
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    await waitFor(() =>
      expect(createListingBody()).toMatchObject({ price: 1500.5 }),
    );
    expect(
      screen.queryByText(/title, description, and price are required/i),
    ).toBeNull();
  });

  it("still rejects text that is not a price", async () => {
    const user = userEvent.setup();
    renderCreateForm();
    await fillTitleAndDescription(user);

    await user.type(screen.getByLabelText(/^price/i), "abc");
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    // Task 13's own priceError field is superseded by the M10 summary, but the fix
    // round that added per-field wiring back (M10's other half — see the "wires an
    // invalid (non-empty) price" test below) means this message now appears twice:
    // once as a summary link, once as the field's own <p role="alert">. findByText
    // would throw "multiple elements" here, so this only asserts the message reached
    // the page at all — the per-field and summary tests below cover *where*.
    expect(await screen.findAllByText(/enter a price like 19\.99/i)).not.toHaveLength(0);
  });
});

describe("M10 — a blank submit shows one error summary", () => {
  it("summarises every missing field in one place and moves focus to it", async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.click(screen.getByRole("button", { name: /create listing/i }));

    const summary = await screen.findByText(/3 fields need attention/i);
    expect(summary.closest('[role="alert"]')).toHaveFocus();
    expect(createListingCalls()).toHaveLength(0);
  });

  it("links each summary entry to its field", async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.click(screen.getByRole("button", { name: /create listing/i }));
    await screen.findByText(/fields need attention/i);

    const summary = screen
      .getByText(/fields need attention/i)
      .closest('[role="alert"]') as HTMLElement;
    expect(within(summary).getByRole("link", { name: "Title is required" })).toHaveAttribute(
      "href",
      "#listing-title",
    );
    expect(
      within(summary).getByRole("link", { name: "Description is required" }),
    ).toHaveAttribute("href", "#listing-description");
    expect(within(summary).getByRole("link", { name: "Price is required" })).toHaveAttribute(
      "href",
      "#listing-price",
    );
  });

  it("reports an invalid price as its own summary entry, distinct from a missing one", async () => {
    const user = userEvent.setup();
    renderCreateForm();
    await fillTitleAndDescription(user);

    await user.type(screen.getByLabelText(/^price/i), "abc");
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    const summary = await screen.findByText(/1 field needs attention/i);
    expect(
      within(summary.closest('[role="alert"]') as HTMLElement).getByRole("link", {
        name: "Enter a price like 19.99",
      }),
    ).toHaveAttribute("href", "#listing-price");
  });

  it("clears the summary once every field is fixed and the form is resubmitted", async () => {
    const user = userEvent.setup();
    mockCreateListing({ id: 1 });
    renderCreateForm();

    await user.click(screen.getByRole("button", { name: /create listing/i }));
    await screen.findByText(/fields need attention/i);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    await waitFor(() => expect(createListingCalls()).toHaveLength(1));
    expect(screen.queryByText(/fields need attention/i)).toBeNull();
  });

  it("wires aria-invalid and aria-describedby on Title and Price themselves, not just the summary", async () => {
    // M10 named two defects for this form: a collapsed banner string, AND no
    // field-level error at all. The summary fixes the first; this fixes the second —
    // a screen reader user who tabs straight to an invalid field, without ever
    // encountering the summary, must still hear why it's invalid.
    const user = userEvent.setup();
    renderCreateForm();

    await user.click(screen.getByRole("button", { name: /create listing/i }));
    await screen.findByText(/fields need attention/i);

    const title = screen.getByLabelText(/^title/i);
    expect(title).toHaveAttribute("aria-invalid", "true");
    const titleDescribedBy = title.getAttribute("aria-describedby");
    expect(titleDescribedBy).toBeTruthy();
    expect(document.getElementById(titleDescribedBy!)).toHaveTextContent("Title is required");

    const priceField = screen.getByLabelText(/^price/i);
    expect(priceField).toHaveAttribute("aria-invalid", "true");
    const priceDescribedBy = priceField.getAttribute("aria-describedby");
    expect(priceDescribedBy).toBeTruthy();
    expect(document.getElementById(priceDescribedBy!)).toHaveTextContent("Price is required");
  });

  it("wires aria-invalid and aria-describedby on the Description textarea too, hand-rolled the same as InputField's own", async () => {
    // Description is a raw <textarea>, not an InputField, so it has no error prop to
    // lean on -- but leaving it silently un-wired while Title and Price announce their
    // own invalidity would read as an oversight, not a boundary.
    const user = userEvent.setup();
    renderCreateForm();

    // Before any submit: no problem, so aria-describedby must be ABSENT, not merely
    // empty -- a matcher that only checked falsiness would not catch a stray
    // aria-describedby="" left pointing at nothing.
    expect(descriptionBox()).not.toHaveAttribute("aria-describedby");

    await user.click(screen.getByRole("button", { name: /create listing/i }));
    await screen.findByText(/fields need attention/i);

    const description = descriptionBox();
    expect(description).toHaveAttribute("aria-invalid", "true");
    const describedBy = description.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Description is required");
  });

  it("wires an invalid (non-empty) price's own message to the Price field", async () => {
    const user = userEvent.setup();
    renderCreateForm();
    await fillTitleAndDescription(user);

    await user.type(screen.getByLabelText(/^price/i), "abc");
    await user.click(screen.getByRole("button", { name: /create listing/i }));

    const priceField = await screen.findByLabelText(/^price/i);
    await waitFor(() => expect(priceField).toHaveAttribute("aria-invalid", "true"));
    const describedBy = priceField.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Enter a price like 19.99");
  });
});

describe("L22 — unsaved-changes guard", () => {
  it("does not block navigation away from an untouched form", () => {
    renderCreateForm();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("blocks navigation away once a field has been edited", async () => {
    const user = userEvent.setup();
    renderCreateForm();
    await user.type(screen.getByLabelText(/^title/i), "Mountain bike");

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("stops blocking once the dirty field is reverted", async () => {
    const user = userEvent.setup();
    renderCreateForm();
    await user.type(screen.getByLabelText(/^title/i), "Mountain bike");
    await user.clear(screen.getByLabelText(/^title/i));

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
