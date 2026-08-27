"use client";

/**
 * C2C-AI-6 — the "Generate with AI" control.
 *
 * SPEC PHASE SKELETON.
 */
export type DescriptionAssistantProps = {
  /** The listing title, which the model needs and which gates the button. */
  title: string;
  /** Whether the description field already has content — drives the overwrite confirm. */
  hasDescription: boolean;
  /** Called with the generated text; the form owns the field. */
  onGenerated: (description: string) => void;
};

export default function DescriptionAssistant(
  _props: DescriptionAssistantProps,
): React.ReactElement | null {
  throw new Error("not implemented — C2C-AI-6 is in its spec phase");
}
