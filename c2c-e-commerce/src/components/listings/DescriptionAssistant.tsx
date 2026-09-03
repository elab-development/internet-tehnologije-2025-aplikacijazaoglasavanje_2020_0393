"use client";

import { useState } from "react";

import { Button, ErrorAlert, Modal } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

const MIN_TITLE_LENGTH = 3;

export type DescriptionAssistantProps = {
  /** The listing title, which the model needs and which gates the button. */
  title: string;
  /** Whether the description field already has content — drives the overwrite confirm. */
  hasDescription: boolean;
  /** Called with the generated text; the form owns the field. */
  onGenerated: (description: string) => void;
};

type GeneratedDescription = {
  description: string;
  model: string;
  generatedAt: string;
};

/**
 * C2C-AI-6 — the "Generate with AI" control.
 *
 * The model writes a draft; the seller still ships it. Nothing here writes to the listing:
 * the generated text goes into the form's field, where it stays fully editable.
 */
export default function DescriptionAssistant({
  title,
  hasDescription,
  onGenerated,
}: DescriptionAssistantProps): React.ReactElement | null {
  const { user } = useAuth();

  const [keywords, setKeywords] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The role is checked here rather than left to the caller's ProtectedRoute. AC7 is about
  // a buyer who reached the form anyway — exactly the case where that wrapper did not do
  // its job.
  if (user?.role !== "seller" && user?.role !== "admin") return null;

  const titleTooShort = title.trim().length < MIN_TITLE_LENGTH;

  async function generate() {
    setConfirmOpen(false);
    setLoading(true);
    setError(null);

    try {
      // Blank entries dropped, so "a, , b," does not become a 400 from AI-5's per-keyword
      // minimum length.
      const list = keywords
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean);

      const result = await api.post<GeneratedDescription>(
        "/api/listings/generate-description",
        { title: title.trim(), ...(list.length > 0 ? { keywords: list } : {}) },
      );

      onGenerated(result.description);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Could not generate a description. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <ErrorAlert message={error} />}

      <div data-testid="assistant-row" className="flex flex-wrap items-end gap-2">
        {/* min-w-0 so the input can shrink inside the flex row: without it a flex item
            refuses to go below its content width, which is the usual cause of a row
            overflowing on a phone. */}
        <div className="min-w-0 flex-1 basis-48">
          <label
            htmlFor="ai-keywords"
            className="mb-1 block text-sm font-medium text-ink-2"
          >
            Keywords <span className="text-ink-3">(optional)</span>
          </label>
          <input
            id="ai-keywords"
            type="text"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder="26 inch, aluminium"
            className="w-full rounded-none border border-rule-strong px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink focus:ring-2 focus:ring-ink/20"
          />
        </div>

        <Button
          type="button"
          variant="secondary"
          loading={loading}
          disabled={titleTooShort || loading}
          onClick={() => (hasDescription ? setConfirmOpen(true) : generate())}
          title={
            titleTooShort
              ? `Enter a title of at least ${MIN_TITLE_LENGTH} characters first`
              : "Draft a description from the title and keywords"
          }
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.7 10.4 12.2 5 10.6 10.4 9Z" />
              <path d="M18.5 15.5 19.2 18l2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" />
            </svg>
          }
        >
          Generate with AI
        </Button>
      </div>

      {/* The existing Modal rather than window.confirm: the codebase already confirms an
          order this way, and a native dialog beside it would look like a bug. */}
      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Replace the description?"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            You have already written a description. Generating a new one will replace it.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            {/* Nothing is requested until this point: generating first and discarding on
                cancel would spend a rate-limited call to show the seller nothing. */}
            <Button type="button" onClick={generate}>
              Replace it
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
