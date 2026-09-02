"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RiErrorWarningLine } from "@remixicon/react";

import { Button, EmptyState } from "@/components/ui";

/**
 * Segment error boundary.
 *
 * Every page under (frontend) is a client component, so a render-time throw used to
 * unwind to the root and replace the whole document with Next's bare "Application
 * error" screen — no navbar, no footer, no link back. This keeps the app's chrome and
 * offers both a retry and a way on.
 */
export default function ErrorBoundaryPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // The digest is what correlates this with the server log; the message itself is
    // not user-facing copy — it can carry internal details like a DB host.
    console.error("Unhandled render error", error.digest ?? error);
  }, [error]);

  return (
    <>
      {/* EmptyState's own title renders as an <h2> (four other consumers rely on that
          staying an h2), and this page renders nothing else -- so without a top-level
          heading here the page has an h2 with no h1 above it, the same shape H8 named
          as a defect on /listings. Visually hidden because EmptyState's icon + title
          already say this on screen; this just gives the page a real h1 in the tree. */}
      <h1 className="sr-only">Something went wrong</h1>
      <EmptyState
        icon={<RiErrorWarningLine size={28} aria-hidden="true" />}
        title="Something went wrong"
        description="The page could not be displayed. Trying again often works; if it does not, head back to the marketplace."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={reset}>Try again</Button>
            {/* Was a `<Link>` wrapping a `<Button>` -- an anchor's content model forbids
                interactive descendants, so that was invalid HTML and put two focusable
                stops with the same accessible name behind one action. This matches the
                `Button` + `router.push` pattern every other `EmptyState` CTA in this
                codebase already uses (orders/page.tsx, listings/page.tsx,
                SellerListingsTab.tsx). */}
            <Button variant="secondary" onClick={() => router.push("/listings")}>
              Browse listings
            </Button>
          </div>
        }
      />
    </>
  );
}
